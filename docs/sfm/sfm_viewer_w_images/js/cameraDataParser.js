/**
 * Camera Data Parser Utility
 * Handles various camera data formats for SFM point cloud viewers
 * Supports Agisoft PhotoScan/Metashape XML, JSON formats, and Google Cloud Storage
 */

class CameraDataParser {
  
  /**
   * Parse Agisoft camera XML data
   */
  static parseAgisoftXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('XML parsing failed: ' + parserError.textContent);
    }

    const cameras = [];
    const cameraElements = xmlDoc.querySelectorAll('camera');
    
    console.log(`Found ${cameraElements.length} cameras in XML`);

    cameraElements.forEach((camera, index) => {
      try {
        const id = camera.getAttribute('id') || index;
        const label = camera.getAttribute('label') || `Camera_${id}`;
        const transform = camera.querySelector('transform');
        
        if (transform) {
          const matrixText = transform.textContent.trim();
          const matrix = matrixText.split(/\s+/).map(parseFloat);
          
          if (matrix.length >= 16) {
            // 4x4 transformation matrix (row-major)
            const position = [matrix[3], matrix[7], matrix[11]];
            
            // Extract 3x3 rotation matrix
            const rotationMatrix = [
              matrix[0], matrix[1], matrix[2],
              matrix[4], matrix[5], matrix[6],
              matrix[8], matrix[9], matrix[10]
            ];

            // Calculate Euler angles from rotation matrix
            const euler = CameraDataParser.matrixToEulerAngles(rotationMatrix);

            cameras.push({
              id: parseInt(id) || index,
              label: label,
              imageName: label + '.jpg', // Assume JPG extension
              position: position,
              rotationMatrix: rotationMatrix,
              rotation: euler, // [roll, pitch, yaw] in radians
              transformMatrix: matrix
            });
          }
        }
      } catch (error) {
        console.warn(`Error parsing camera ${index}:`, error);
      }
    });

    console.log(`Successfully parsed ${cameras.length} cameras`);
    return cameras;
  }

  /**
   * Parse JSON camera data (various formats)
   */
  static parseJSONData(jsonData) {
    if (Array.isArray(jsonData)) {
      return jsonData; // Already in array format
    }
    
    if (jsonData.cameras && Array.isArray(jsonData.cameras)) {
      return jsonData.cameras;
    }
    
    // Check if it's a single camera object
    if (jsonData.position || jsonData.transform) {
      return [jsonData];
    }

    // Check if it's an object with camera IDs as keys
    const cameras = [];
    for (const [key, value] of Object.entries(jsonData)) {
      if (typeof value === 'object' && value !== null) {
        cameras.push({
          id: key,
          ...value
        });
      }
    }

    return cameras;
  }

  /**
   * Convert 3x3 rotation matrix to Euler angles (XYZ order)
   */
  static matrixToEulerAngles(matrix) {
    if (matrix.length !== 9) {
      throw new Error('Rotation matrix must have 9 elements');
    }

    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = matrix;
    
    let x, y, z;

    // Check for gimbal lock
    if (Math.abs(m12) >= 1) {
      z = 0; // Set yaw to 0
      if (m12 < 0) {
        y = Math.PI / 2;
        x = z + Math.atan2(m01, m02);
      } else {
        y = -Math.PI / 2;
        x = -z + Math.atan2(-m01, -m02);
      }
    } else {
      y = -Math.asin(m12);
      x = Math.atan2(m22, m11);
      z = Math.atan2(m10, m00);
    }

    return [x, y, z]; // [pitch, yaw, roll] in radians
  }

  /**
   * Convert Euler angles to degrees
   */
  static radiansToDegrees(radians) {
    return radians.map(r => r * 180 / Math.PI);
  }

  /**
   * Create camera frustum parameters for Three.js
   */
  static createFrustumParams(camera, focalLength = 1000, imageWidth = 1920, imageHeight = 1080) {
    const params = {
      ...camera,
      frustum: {
        focalLength: focalLength,
        imageWidth: imageWidth,
        imageHeight: imageHeight,
        planeWidth: imageWidth / focalLength,
        planeHeight: imageHeight / focalLength,
        aspectRatio: imageWidth / imageHeight
      }
    };

    return params;
  }

  /**
   * Create camera data suitable for Google Cloud Storage URLs
   */
  static prepareForGoogleCloud(cameras, baseURL, imageDir = '01_IMAGES', thumbnailDir = '02_THUMBNAILS') {
    return cameras.map(camera => ({
      ...camera,
      imageURL: `${baseURL}/${imageDir}/${camera.imageName || camera.label}`,
      thumbnailURL: `${baseURL}/${thumbnailDir}/${camera.imageName || camera.label}`,
      baseURL: baseURL
    }));
  }

  /**
   * Validate camera data format
   */
  static validateCameraData(cameras) {
    if (!Array.isArray(cameras)) {
      throw new Error('Camera data must be an array');
    }

    const errors = [];
    cameras.forEach((camera, index) => {
      if (!camera.position || !Array.isArray(camera.position) || camera.position.length !== 3) {
        errors.push(`Camera ${index}: Invalid or missing position`);
      }
      
      if (camera.rotationMatrix && (!Array.isArray(camera.rotationMatrix) || camera.rotationMatrix.length !== 9)) {
        errors.push(`Camera ${index}: Invalid rotation matrix`);
      }
      
      if (!camera.label && !camera.id) {
        errors.push(`Camera ${index}: Missing label or id`);
      }
    });

    if (errors.length > 0) {
      throw new Error('Validation errors:\n' + errors.join('\n'));
    }

    return true;
  }

  /**
   * Convert camera data to potree-sfm compatible format
   */
  static toPotreeSFMFormat(cameras) {
    return cameras.map((camera, index) => {
      const euler = camera.rotation || CameraDataParser.matrixToEulerAngles(camera.rotationMatrix || [1,0,0,0,1,0,0,0,1]);
      const eulerDegrees = CameraDataParser.radiansToDegrees(euler);
      
      return {
        id: camera.id || index,
        name: camera.label || camera.imageName || `Camera_${index}`,
        position: {
          x: camera.position[0],
          y: camera.position[1],
          z: camera.position[2]
        },
        rotation: {
          roll: eulerDegrees[0],
          pitch: eulerDegrees[1],
          yaw: eulerDegrees[2]
        },
        imageName: camera.imageName || camera.label,
        visible: true
      };
    });
  }

  /**
   * Load and parse camera data from URL
   */
  static async loadFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      
      if (url.endsWith('.xml') || (contentType && contentType.includes('xml'))) {
        const xmlText = await response.text();
        return CameraDataParser.parseAgisoftXML(xmlText);
      } else if (url.endsWith('.json') || (contentType && contentType.includes('json'))) {
        const jsonData = await response.json();
        return CameraDataParser.parseJSONData(jsonData);
      } else {
        // Try to guess format from content
        const text = await response.text();
        if (text.trim().startsWith('<')) {
          return CameraDataParser.parseAgisoftXML(text);
        } else {
          return CameraDataParser.parseJSONData(JSON.parse(text));
        }
      }
    } catch (error) {
      console.error('Error loading camera data from URL:', error);
      throw error;
    }
  }

  /**
   * Export camera data to various formats
   */
  static exportToJSON(cameras, pretty = true) {
    const validated = CameraDataParser.validateCameraData(cameras);
    return JSON.stringify(cameras, null, pretty ? 2 : 0);
  }

  /**
   * Create example URL parameters for the enhanced viewer
   */
  static createViewerURL(baseURL, options = {}) {
    const params = new URLSearchParams();
    
    if (options.pointCloudSrc) params.set('src', options.pointCloudSrc);
    if (options.title) params.set('title', options.title);
    if (options.cameraSrc) params.set('cameras', options.cameraSrc);
    if (options.imageBase) params.set('imageBase', options.imageBase);
    
    return `${baseURL}/enhanced-sfm-viewer.html?${params.toString()}`;
  }
}

// Export for use in browser
window.CameraDataParser = CameraDataParser;

// Export for Node.js if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CameraDataParser;
}
