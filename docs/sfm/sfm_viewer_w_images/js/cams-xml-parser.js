/**
 * Parser for Agisoft Photoscan/Metashape .cams.xml files
 * Converts camera data to format usable in Potree viewer
 */

class CamsXMLParser {
  constructor() {
    this.cameras = [];
    this.sensor = null;
    this.transform = null;
  }

  /**
   * Parse .cams.xml file
   * @param {string} xmlString - The XML content as string
   * @returns {Array} Array of camera objects with positions and parameters
   */
  async parseXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    // Check for parsing errors
    const parseError = xmlDoc.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
      throw new Error("XML parsing error: " + parseError[0].textContent);
    }
    
    // Extract sensor information
    this.sensor = this.extractSensorInfo(xmlDoc);
    
    // Extract component transform (chunk transformation)
    this.transform = this.extractComponentTransform(xmlDoc);
    
    // Debug component transform
    if (this.transform) {
      console.log('[Parser] Component transform found:', this.transform);
    } else {
      console.log('[Parser] No component transform found');
    }
    
    // Extract camera data
    this.cameras = this.extractCameras(xmlDoc);
    
    return {
      cameras: this.cameras,
      sensor: this.sensor,
      transform: this.transform
    };
  }
  
  /**
   * Extract sensor/camera calibration info
   */
  extractSensorInfo(xmlDoc) {
    const sensor = xmlDoc.querySelector('sensor');
    if (!sensor) return null;
    
    const resolution = sensor.querySelector('resolution');
    const calibration = sensor.querySelector('calibration');
    
    const info = {
      id: sensor.getAttribute('id'),
      label: sensor.getAttribute('label'),
      type: sensor.getAttribute('type'),
      width: resolution ? parseInt(resolution.getAttribute('width')) : null,
      height: resolution ? parseInt(resolution.getAttribute('height')) : null
    };
    
    if (calibration) {
      info.f = parseFloat(calibration.querySelector('f')?.textContent || '0');
      info.cx = parseFloat(calibration.querySelector('cx')?.textContent || '0');
      info.cy = parseFloat(calibration.querySelector('cy')?.textContent || '0');
      info.k1 = parseFloat(calibration.querySelector('k1')?.textContent || '0');
      info.k2 = parseFloat(calibration.querySelector('k2')?.textContent || '0');
      info.k3 = parseFloat(calibration.querySelector('k3')?.textContent || '0');
      info.p1 = parseFloat(calibration.querySelector('p1')?.textContent || '0');
      info.p2 = parseFloat(calibration.querySelector('p2')?.textContent || '0');
    }
    
    return info;
  }
  
  /**
   * Extract component transform matrix
   */
  extractComponentTransform(xmlDoc) {
    const component = xmlDoc.querySelector('component');
    if (!component) return null;
    
    const transform = component.querySelector('transform');
    if (!transform) return null;
    
    const rotation = transform.querySelector('rotation');
    const translation = transform.querySelector('translation');
    const scale = transform.querySelector('scale');
    
    return {
      rotation: rotation ? this.parseMatrixString(rotation.textContent, 9) : null,
      translation: translation ? this.parseMatrixString(translation.textContent, 3) : null,
      scale: scale ? parseFloat(scale.textContent) : 1.0
    };
  }
  
  /**
   * Extract all camera transformations
   */
  extractCameras(xmlDoc) {
    const cameraElements = xmlDoc.querySelectorAll('camera');
    const cameras = [];
    
    cameraElements.forEach((camEl, index) => {
      const enabled = camEl.getAttribute('enabled');
      
      // Skip disabled cameras
      if (enabled === 'false') {
        console.log(`Skipping disabled camera: ${camEl.getAttribute('label')}`);
        return;
      }
      
      const transformEl = camEl.querySelector('transform');
      if (!transformEl) {
        console.log(`No transform for camera: ${camEl.getAttribute('label')}`);
        return;
      }
      
      const transformMatrix = this.parseMatrixString(transformEl.textContent, 16);
      
      // Debug first camera
      if (index === 0) {
        console.log('[Parser Debug] First camera transform matrix:', transformMatrix);
        console.log('[Parser Debug] Matrix elements 12,13,14:', transformMatrix[12], transformMatrix[13], transformMatrix[14]);
        console.log('[Parser Debug] Matrix elements 3,7,11:', transformMatrix[3], transformMatrix[7], transformMatrix[11]);
      }
      
      // Extract position from transform matrix
      // Agisoft uses ROW-MAJOR 4x4 matrix: translation is at indices 3, 7, 11
      const position = [
        transformMatrix[3],
        transformMatrix[7],
        transformMatrix[11]
      ];
      
      // Extract rotation matrix (first 3x3)
      const rotation = [
        transformMatrix[0], transformMatrix[1], transformMatrix[2],
        transformMatrix[4], transformMatrix[5], transformMatrix[6],
        transformMatrix[8], transformMatrix[9], transformMatrix[10]
      ];
      
      const camera = {
        id: parseInt(camEl.getAttribute('id')),
        label: camEl.getAttribute('label'),
        sensor_id: camEl.getAttribute('sensor_id'),
        enabled: enabled !== 'false',
        transform: transformMatrix,
        position: position,
        rotation: rotation,
        // For image file path (you'll need to provide this separately or from .meta.json)
        imagePath: null
      };
      
      cameras.push(camera);
    });
    
    console.log(`Parsed ${cameras.length} enabled cameras from XML`);
    return cameras;
  }
  
  /**
   * Parse space-separated number string into array
   */
  parseMatrixString(str, expectedLength) {
    const numbers = str.trim().split(/\s+/).map(s => parseFloat(s));
    if (numbers.length !== expectedLength) {
      console.warn(`Expected ${expectedLength} values, got ${numbers.length}`);
    }
    return numbers;
  }
  
  /**
   * Load and parse from URL
   */
  async loadFromURL(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }
    const xmlString = await response.text();
    return this.parseXML(xmlString);
  }
  
  /**
   * Load and merge with .meta.json file (contains image paths)
   */
  async loadWithMetaJSON(camsXMLUrl, metaJSONUrl) {
    // Load both files
    const camsData = await this.loadFromURL(camsXMLUrl);
    
    try {
      const metaResponse = await fetch(metaJSONUrl);
      if (metaResponse.ok) {
        const metaData = await metaResponse.json();
        
        // Merge image paths into camera data
        if (metaData.cameras) {
          this.cameras.forEach(camera => {
            // Find matching camera in meta.json by label/key
            const metaCamera = Object.values(metaData.cameras).find(
              mc => mc.path && mc.path.includes(camera.label)
            );
            
            if (metaCamera) {
              camera.imagePath = metaCamera.path;
              camera.center = metaCamera.center;
            }
          });
        }
      }
    } catch (error) {
      console.warn('Could not load meta.json:', error);
    }
    
    return camsData;
  }
  
  /**
   * Convert to Potree-compatible format
   */
  toPotreeFormat(imageBaseURL = '') {
    return this.cameras.map(camera => {
      // Apply component transform to position (convert from chunk space to world space)
      let worldPos = [...camera.position];
      
      if (this.transform) {
        // Apply scale
        const s = this.transform.scale || 1.0;
        worldPos = [worldPos[0] * s, worldPos[1] * s, worldPos[2] * s];
        
        // Apply rotation (3x3 matrix multiplication)
        if (this.transform.rotation) {
          const R = this.transform.rotation;
          const [x, y, z] = worldPos;
          worldPos = [
            R[0] * x + R[1] * y + R[2] * z,
            R[3] * x + R[4] * y + R[5] * z,
            R[6] * x + R[7] * y + R[8] * z
          ];
        }
        
        // Apply translation
        if (this.transform.translation) {
          const T = this.transform.translation;
          worldPos = [
            worldPos[0] + T[0],
            worldPos[1] + T[1],
            worldPos[2] + T[2]
          ];
        }
      }
      // Calculate VERTICAL FOV from focal length if available
      let fov = 60; // default
      if (this.sensor && this.sensor.f && this.sensor.height) {
        // Calculate VERTICAL FOV directly from focal length in pixels
        // The visibility check expects vertical FOV, so we use sensor HEIGHT
        // Vertical FOV = 2 * atan(sensor_height_pixels / (2 * focal_length_pixels))
        const focalLengthPixels = this.sensor.f;
        const sensorHeightPixels = this.sensor.height;
        fov = 2 * Math.atan(sensorHeightPixels / (2 * focalLengthPixels)) * (180 / Math.PI);
        console.log(`[CamsParser] VERTICAL FOV calculation: f=${focalLengthPixels}px, h=${sensorHeightPixels}px → FOV=${fov.toFixed(1)}°`);
      }
      
      // Calculate aspect ratio
      const aspect = this.sensor ? this.sensor.width / this.sensor.height : 1.5;
      
      // Build image URL
      let imageURL = null;
      if (camera.imagePath) {
        // Extract filename from path
        const filename = camera.imagePath.split(/[/\\]/).pop();
        imageURL = imageBaseURL ? `${imageBaseURL}/${filename}` : filename;
      } else {
        // Try to construct from label
        imageURL = imageBaseURL ? `${imageBaseURL}/${camera.label}.JPG` : `${camera.label}.JPG`;
      }
      
      // Convert rotation matrix to quaternion (simplified - you may need a proper conversion)
      const rotation = camera.rotation;
      const quaternion = this.rotationMatrixToQuaternion(rotation);
      
      return {
        id: camera.id,
        name: camera.label,
        label: camera.label,
        position: worldPos,  // Use world position after component transform
        rotation: quaternion,
        rotationMatrix: rotation,
        transform: camera.transform,
        fov: fov,
        aspect: aspect,
        image: imageURL,
        enabled: camera.enabled
      };
    });
  }
  
  /**
   * Convert 3x3 rotation matrix to quaternion
   * Based on: https://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToQuaternion/
   */
  rotationMatrixToQuaternion(m) {
    // m is [m00, m01, m02, m10, m11, m12, m20, m21, m22]
    const trace = m[0] + m[4] + m[8];
    let x, y, z, w;
    
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      w = 0.25 / s;
      x = (m[7] - m[5]) * s;
      y = (m[2] - m[6]) * s;
      z = (m[3] - m[1]) * s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const s = 2.0 * Math.sqrt(1.0 + m[0] - m[4] - m[8]);
      w = (m[7] - m[5]) / s;
      x = 0.25 * s;
      y = (m[1] + m[3]) / s;
      z = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
      const s = 2.0 * Math.sqrt(1.0 + m[4] - m[0] - m[8]);
      w = (m[2] - m[6]) / s;
      x = (m[1] + m[3]) / s;
      y = 0.25 * s;
      z = (m[5] + m[7]) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m[8] - m[0] - m[4]);
      w = (m[3] - m[1]) / s;
      x = (m[2] + m[6]) / s;
      y = (m[5] + m[7]) / s;
      z = 0.25 * s;
    }
    
    return [x, y, z, w];
  }
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.CamsXMLParser = CamsXMLParser;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CamsXMLParser;
}
