/**
 * Camera Overlay Module for SFM Point Cloud Viewer
 * Based on potree-sfm implementation
 * Handles camera frustums, image planes, and image overlay functionality
 */

class SFMCameraOverlay {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.scene = viewer.scene.scene; // Three.js scene
    this.options = {
      baseURL: options.baseURL || '',
      imageDir: options.imageDir || '01_IMAGES',
      thumbnailDir: options.thumbnailDir || '02_THUMBNAILS',
      scaleImage: options.scaleImage || 1.0,
      showFrustums: options.showFrustums !== false,
      showImagePlane: options.showImagePlane !== false,
      ...options
    };

    // Camera data
    this.cameras = [];
    this.currentCameraId = null;
    this.cameraObjects = [];
    this.imageplane = null;
    this.activeCameraPlane = false;

    // State
    this.lastPosition = [0, 0, 0];
    this.lookAtPoint = null;
    this.filterImages = false;

    this.init();
    
    // Enhanced mouse interaction from potree-sfm
    this.mouse = { x: 0, y: 0, doUse: false };
    this.raycaster = new THREE.Raycaster();
    this.INTERSECTED = null;
    this.camsVisible = true;
    
    // Bind event handlers for interactive features
    this.initInteraction();
  }

  /**
   * Initialize mouse interaction system (based on potree-sfm)
   */
  initInteraction() {
    const canvas = this.viewer.renderer.domElement;
    
    canvas.addEventListener('mousemove', (event) => {
      // Update mouse coordinates
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      // Only use raycasting when over canvas
      const elementType = document.elementFromPoint(event.clientX, event.clientY)?.tagName;
      this.mouse.doUse = elementType === 'CANVAS';
      
      this.checkIntersections();
    });
    
    canvas.addEventListener('click', (event) => {
      if (this.INTERSECTED && this.INTERSECTED.userData?.type === 'imageFrustum') {
        const imageName = this.INTERSECTED.userData.imageName;
        console.log('🎯 Clicked on camera:', imageName);
        // Could implement camera switching here like potree-sfm
      }
    });
    
    // Add keyboard shortcuts (like potree-sfm)
    document.addEventListener('keydown', (event) => {
      this.onKeyPress(event);
    });
  }
  
  /**
   * Handle keyboard shortcuts (from potree-sfm)
   */
  onKeyPress(event) {
    switch(event.code) {
      case 'KeyI':
        // Toggle image visibility
        this.toggleCamerasVisible();
        break;
      case 'ArrowLeft':
        // Previous camera
        this.navigateCamera(-1);
        break;
      case 'ArrowRight':  
        // Next camera
        this.navigateCamera(1);
        break;
      case 'KeyV':
        // Toggle camera plane view
        this.toggleCameraPlane();
        break;
    }
  }
  
  /**
   * Navigate to previous/next camera
   */
  navigateCamera(direction) {
    if (this.cameras.length === 0) return;
    
    let newIndex;
    if (this.currentCameraId === null) {
      newIndex = direction > 0 ? 0 : this.cameras.length - 1;
    } else {
      const currentIndex = this.cameras.findIndex(cam => cam.id === this.currentCameraId);
      newIndex = (currentIndex + direction + this.cameras.length) % this.cameras.length;
    }
    
    this.flyToCamera(newIndex);
    this.currentCameraId = this.cameras[newIndex].id;
    console.log(`📷 Navigated to camera: ${this.cameras[newIndex].label}`);
  }
  
  /**
   * Toggle camera plane view
   */
  toggleCameraPlane() {
    this.activeCameraPlane = !this.activeCameraPlane;
    
    if (this.imageplane) {
      this.imageplane.visible = this.activeCameraPlane;
      console.log(`🖼️ Camera plane ${this.activeCameraPlane ? 'visible' : 'hidden'}`);
    }
  }
  
  /**
   * Check for mouse intersection with camera frustums (from potree-sfm)
   */
  checkIntersections() {
    if (this.mouse.doUse) {
      this.raycaster.setFromCamera(this.mouse, this.viewer.scene.cameraP);
      
      // Find intersectable objects (camera frustums)
      const intersectableObjects = [];
      this.scene.traverse((object) => {
        if (object.userData?.type === 'imageFrustum') {
          intersectableObjects.push(object);
        }
      });
      
      const intersects = this.raycaster.intersectObjects(intersectableObjects, true);
      
      if (intersects.length > 0) {
        let closestFrustum = null;
        let closestDistance = Infinity;
        
        // Find the closest frustum (similar to potree-sfm logic)
        for (const intersect of intersects) {
          const frustum = intersect.object.parent;
          if (frustum.userData?.type === 'imageFrustum' && intersect.distance < closestDistance) {
            closestDistance = intersect.distance;
            closestFrustum = frustum;
          }
        }
        
        if (closestFrustum && this.INTERSECTED !== closestFrustum) {
          // Reset previous highlight
          if (this.INTERSECTED) {
            this.resetFrustumHighlight(this.INTERSECTED);
          }
          
          // Highlight new frustum
          this.INTERSECTED = closestFrustum;
          this.highlightFrustum(this.INTERSECTED);
        }
      } else {
        // No intersection - reset highlight
        if (this.INTERSECTED) {
          this.resetFrustumHighlight(this.INTERSECTED);
          this.INTERSECTED = null;
        }
      }
    }
  }
  
  /**
   * Highlight a camera frustum on hover
   */
  highlightFrustum(frustum) {
    frustum.traverse((child) => {
      if (child.material) {
        child.userData.originalColor = child.material.color.clone();
        child.material.color.set(0xff0000); // Red highlight like potree-sfm
      }
    });
  }
  
  /**
   * Reset frustum highlight
   */
  resetFrustumHighlight(frustum) {
    frustum.traverse((child) => {
      if (child.material && child.userData.originalColor) {
        child.material.color.copy(child.userData.originalColor);
      }
    });
  }

  /**
   * Toggle visibility of all camera frustums (like potree-sfm)
   */
  toggleCamerasVisible() {
    this.camsVisible = !this.camsVisible;
    console.log(`📷 Camera frustums ${this.camsVisible ? 'visible' : 'hidden'}`);
    
    this.scene.traverse((object) => {
      if (object.userData?.type === 'imageFrustum') {
        object.visible = this.camsVisible;
      }
    });
    
    return this.camsVisible;
  }
  
  /**
   * Turn camera frustums on
   */
  turnCamerasOn() {
    this.camsVisible = true;
    this.scene.traverse((object) => {
      if (object.userData?.type === 'imageFrustum') {
        object.visible = true;
      }
    });
  }
  
  /**
   * Turn camera frustums off  
   */
  turnCamerasOff() {
    this.camsVisible = false;
    this.scene.traverse((object) => {
      if (object.userData?.type === 'imageFrustum') {
        object.visible = false;
      }
    });
  }
  
  /**
   * Get current camera position (like potree-sfm getCurrentPos)
   */
  getCurrentPosition() {
    const pos = this.viewer.scene.view.position;
    return [
      Math.round(pos.x * 100) / 100,
      Math.round(pos.y * 100) / 100, 
      Math.round(pos.z * 100) / 100
    ];
  }
  
  /**
   * Move viewer to specific camera position (like potree-sfm moveCamera)
   */
  flyToCamera(cameraIndex) {
    if (cameraIndex < 0 || cameraIndex >= this.cameras.length) {
      console.warn('Invalid camera index:', cameraIndex);
      return;
    }
    
    const camera = this.cameras[cameraIndex];
    console.log(`🚁 Flying to camera: ${camera.label}`);
    
    // Set viewer position
    this.viewer.scene.view.position.set(
      camera.position[0],
      camera.position[1], 
      camera.position[2]
    );
    
    // Look in camera direction using transform matrix if available
    if (camera.transform4x4) {
      const matrix4 = new THREE.Matrix4();
      matrix4.set(
        camera.transform4x4[0], camera.transform4x4[4], camera.transform4x4[8],  camera.transform4x4[12],
        camera.transform4x4[1], camera.transform4x4[5], camera.transform4x4[9],  camera.transform4x4[13], 
        camera.transform4x4[2], camera.transform4x4[6], camera.transform4x4[10], camera.transform4x4[14],
        camera.transform4x4[3], camera.transform4x4[7], camera.transform4x4[11], camera.transform4x4[15]
      );
      
      // Extract forward direction from matrix
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyMatrix4(matrix4);
      forward.normalize();
      
      // Set look-at point
      const lookAt = new THREE.Vector3()
        .copy(this.viewer.scene.view.position)
        .add(forward.multiplyScalar(10));
        
      this.viewer.scene.view.lookAt(lookAt);
    }
  }
  
  /**
   * Get camera by name/label
   */
  getCameraByLabel(label) {
    return this.cameras.find(cam => cam.label === label);
  }
  
  /**
   * Get total number of loaded cameras  
   */
  getCameraCount() {
    return this.cameras.length;
  }

  /**
   * Initialize the camera overlay system
   */
  init() {
    console.log('Initializing SFM Camera Overlay...');
    
    // Set up periodic checks for camera movement
    this.checkMovement = this.checkMovement.bind(this);
    setInterval(this.checkMovement, 100);
  }

  /**
   * Load camera data from XML or JSON
   */
  async loadCameraData(cameraDataURL) {
    try {
      console.log('Loading camera data from:', cameraDataURL);
      const response = await fetch(cameraDataURL);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      if (cameraDataURL.endsWith('.json')) {
        this.cameras = await response.json();
      } else if (cameraDataURL.endsWith('.xml')) {
        const xmlText = await response.text();
        this.cameras = this.parseXMLCameraData(xmlText);
      } else {
        throw new Error('Unsupported file format. Use .xml or .json files.');
      }
      
      console.log(`Loaded ${this.cameras.length} cameras from ${cameraDataURL}`);
      this.createCameraFrustums();
      return this.cameras;
    } catch (error) {
      console.error('Error loading camera data:', error);
      throw error;
    }
  }

  /**
   * Parse XML camera data (Agisoft PhotoScan/Metashape format)
   */
  parseXMLCameraData(xmlText) {
    console.log('Parsing XML camera data...');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const cameras = [];
    
    // Check for XML parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      console.error('XML parsing error:', parserError.textContent);
      throw new Error('Invalid XML format');
    }
    
    // Look for camera elements (Agisoft format)
    const cameraElements = xmlDoc.querySelectorAll('cameras camera');
    console.log(`Found ${cameraElements.length} camera elements in XML`);

    cameraElements.forEach((camera, index) => {
      try {
        const id = camera.getAttribute('id') || index;
        const label = camera.getAttribute('label') || `Camera_${index + 1}`;
        
        console.log(`Processing camera ${index}: id=${id}, label=${label}`);
        
        // Get transform matrix from the transform element
        const transform = camera.querySelector('transform');
        if (transform) {
          const matrixText = transform.textContent.trim();
          const matrix = matrixText.split(/\s+/).map(parseFloat);
          
          if (matrix.length >= 16) {
            // This is a 4x4 transformation matrix, we need to extract position and rotation
            const cameraData = this.createCameraFromTransform4x4(matrix, id, label, index);
            if (cameraData) {
              cameras.push(cameraData);
            }
          } else {
            console.warn(`Camera ${index}: Transform matrix has ${matrix.length} elements, expected 16`);
          }
        } else {
          console.warn(`Camera ${index}: No transform element found`);
        }
        
      } catch (error) {
        console.warn(`Error parsing camera ${index}:`, error);
      }
    });

    console.log(`Successfully parsed ${cameras.length} cameras`);
    
    if (cameras.length === 0) {
      console.warn('No cameras were successfully parsed from XML. XML content preview:', xmlText.substring(0, 500));
    }
    
    return cameras;
  }

  /**
   * Create camera object from 4x4 transformation matrix (Agisoft format)
   */
  createCameraFromTransform4x4(matrix, id, label, index) {
    // 4x4 transformation matrix layout:
    // [0  1  2  3 ]  [m00 m01 m02 tx]
    // [4  5  6  7 ]  [m10 m11 m12 ty]
    // [8  9  10 11]  [m20 m21 m22 tz]
    // [12 13 14 15]  [0   0   0   1 ]
    
    // Extract position (translation) from the matrix
    const position = [matrix[3], matrix[7], matrix[11]];
    
    // Extract 3x3 rotation matrix
    const rotationMatrix = [
      matrix[0], matrix[1], matrix[2],
      matrix[4], matrix[5], matrix[6],
      matrix[8], matrix[9], matrix[10]
    ];

    // Convert rotation matrix to Euler angles
    const euler = this.matrixToEulerAngles(rotationMatrix);
    
    // Create standardized image name - add .JPG extension if not present
    let imageName = label;
    if (!imageName.match(/\.(jpg|jpeg|png|tiff|tif)$/i)) {
      imageName = label + '.JPG'; // Use uppercase .JPG to match Google Cloud Storage
    }
    
    console.log(`✅ Created camera ${index}: ${label} -> ${imageName} at position [${position.map(p => p.toFixed(2)).join(', ')}]`);

    return {
      id: parseInt(id) || index,
      label: label,
      imageName: imageName,
      position: position,
      rotationMatrix: rotationMatrix,
      rotation: euler, // [pitch, yaw, roll] in radians
      transformMatrix: matrix,
      transform4x4: matrix // Keep the full 4x4 matrix for reference
    };
  }

  /**
   * Create camera object from transformation matrix
   */
  createCameraFromMatrix(matrix, id, label, index) {
    // Extract position from transformation matrix (column 4)
    const position = [matrix[3], matrix[7], matrix[11]];
    
    // Extract 3x3 rotation matrix
    const rotationMatrix = [
      matrix[0], matrix[1], matrix[2],
      matrix[4], matrix[5], matrix[6],
      matrix[8], matrix[9], matrix[10]
    ];

    // Convert rotation matrix to Euler angles
    const euler = this.matrixToEulerAngles(rotationMatrix);
    
    // Create standardized image name if label doesn't have extension
    let imageName = label;
    if (!imageName.match(/\.(jpg|jpeg|png|tiff|tif)$/i)) {
      // Try common extensions
      imageName = label + '.jpg'; // Default to .jpg first
    }
    
    console.log(`Created camera ${index}: ${label} at position [${position.join(', ')}]`);

    return {
      id: parseInt(id) || index,
      label: label,
      imageName: imageName,
      position: position,
      rotationMatrix: rotationMatrix,
      rotation: euler, // [pitch, yaw, roll] in radians
      transformMatrix: matrix
    };
  }

  /**
   * Convert 3x3 rotation matrix to Euler angles
   */
  matrixToEulerAngles(matrix) {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = matrix;
    
    let x, y, z;

    // Check for gimbal lock
    if (Math.abs(m12) >= 0.99999) {
      z = 0;
      if (m12 < 0) {
        y = Math.PI / 2;
        x = Math.atan2(m01, m02);
      } else {
        y = -Math.PI / 2;
        x = Math.atan2(-m01, -m02);
      }
    } else {
      y = -Math.asin(Math.max(-1, Math.min(1, m12)));
      x = Math.atan2(m22, m11);
      z = Math.atan2(m10, m00);
    }

    return [x, y, z]; // [pitch, yaw, roll] in radians
  }

  /**
   * Construct image URL with proper encoding
   */
  getImageURL(imageDir, imageName) {
    let url;
    if (this.options.baseURL) {
      // Handle different directory configurations
      if (imageDir) {
        url = `${this.options.baseURL}/${imageDir}/${imageName}`;
      } else {
        url = `${this.options.baseURL}/${imageName}`;
      }
    } else {
      url = `${imageDir}/${imageName}`;
    }
    
    console.log(`Loading image: ${url}`);
    return url;
  }

  /**
   * Create camera frustum objects in the scene
   */
  createCameraFrustums() {
    this.cameraObjects = [];
    
    this.cameras.forEach((camera, index) => {
      const frustum = this.createImageFrustum(
        this.options.thumbnailDir,
        camera.imageName, // Use imageName instead of label
        camera.rotationMatrix,
        camera.position,
        camera.transform4x4 // Pass the 4x4 matrix for better positioning
      );
      
      if (frustum) {
        frustum.userData.cameraId = index;
        frustum.userData.camera = camera;
        frustum.visible = this.options.showFrustums;
        this.scene.add(frustum);
        this.cameraObjects.push(frustum);
        
        console.log(`✅ Added camera frustum ${index} for ${camera.imageName}`);
      } else {
        console.warn(`❌ Failed to create frustum for camera ${index}: ${camera.imageName}`);
      }
    });

    // Create image plane for detailed view
    if (this.cameras.length > 0) {
      this.createImagePlane();
    }
    
    console.log(`Created ${this.cameraObjects.length} camera frustums from ${this.cameras.length} cameras`);
  }

  /**
   * Create image frustum (pyramid + image plane) 
   * Based on potree-sfm approach for proper 3D visualization
   */
  createImageFrustum(imageDir, imageName, rotationMatrix, position, transform4x4) {
    try {
      console.log(`Creating frustum for ${imageName} at position:`, position);
      
      // Load texture with cross-origin support
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      const imageURL = this.getImageURL(imageDir, imageName);
      
      // Camera parameters (adjusted for typical SfM data)
      const focalLength = 35; // mm - standard focal length
      const sensorWidth = 36; // mm - full frame equivalent  
      const sensorHeight = 24; // mm - full frame equivalent
      
      // Calculate frustum dimensions based on camera model from potree-sfm
      const camFocal = 3500; // Effective focal length in pixels (typical for SfM)
      const camPixW = 6000; // Image width in pixels
      const camPixH = 4000; // Image height in pixels
      
      // Scale factors similar to potree-sfm approach
      const pixx = camPixW / camFocal; // Physical plane width
      const pixy = camPixH / camFocal; // Physical plane height
      
      // Create image plane geometry - following potree-sfm pattern
      const imageGeometry = new THREE.PlaneGeometry(pixx, pixy, 1, 1);
      
      // Set image plane at distance -1 (following potree-sfm convention)
      imageGeometry.vertices[0].z = -1;
      imageGeometry.vertices[1].z = -1; 
      imageGeometry.vertices[2].z = -1;
      imageGeometry.vertices[3].z = -1;
      
      // Create image material
      const imageMaterial = new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
      });
      
      const imagePlane = new THREE.Mesh(imageGeometry, imageMaterial);
      
      // Create pyramid geometry - exact same structure as potree-sfm
      const pyramidGeometry = new THREE.Geometry();
      
      pyramidGeometry.vertices = [
        // Image plane corners (following potree-sfm vertex order)
        new THREE.Vector3(-pixx/2, -pixy/2, -1),
        new THREE.Vector3(-pixx/2,  pixy/2, -1),
        new THREE.Vector3( pixx/2,  pixy/2, -1),
        new THREE.Vector3( pixx/2, -pixy/2, -1),
        new THREE.Vector3(0, 0, 0) // Apex at camera center
      ];
      
      pyramidGeometry.faces = [
        new THREE.Face3(1, 0, 4), // Left face
        new THREE.Face3(2, 1, 4), // Top face  
        new THREE.Face3(3, 2, 4), // Right face
        new THREE.Face3(0, 3, 4)  // Bottom face
      ];
      
      // Pyramid material - wireframe like potree-sfm
      const pyramidMaterial = new THREE.MeshBasicMaterial({
        color: 0xf8f9fa, // Light color similar to potree-sfm
        wireframe: true,
        transparent: true,
        opacity: 0.7
      });
      
      const pyramid = new THREE.Mesh(pyramidGeometry, pyramidMaterial);
      
      // Create combined group (following potree-sfm pattern)
      const frustumGroup = new THREE.Group();
      frustumGroup.add(imagePlane);
      frustumGroup.add(pyramid);
      
      // Load texture and apply to image plane
      loader.load(
        imageURL,
        (texture) => {
          console.log(`✅ Texture loaded: ${imageURL}`);
          imageMaterial.map = texture;
          imageMaterial.needsUpdate = true;
        },
        undefined,
        (error) => {
          console.error(`❌ Failed to load texture: ${imageURL}`, error);
          // Create fallback color
          imageMaterial.color = new THREE.Color(0xff6b6b);
        }
      );
      
      // Apply transformation from 4x4 matrix (Agisoft format)
      if (transform4x4 && transform4x4.length >= 16) {
        const matrix4 = new THREE.Matrix4();
        // Agisoft uses column-major order
        matrix4.set(
          transform4x4[0], transform4x4[4], transform4x4[8],  transform4x4[12],
          transform4x4[1], transform4x4[5], transform4x4[9],  transform4x4[13], 
          transform4x4[2], transform4x4[6], transform4x4[10], transform4x4[14],
          transform4x4[3], transform4x4[7], transform4x4[11], transform4x4[15]
        );
        
        frustumGroup.applyMatrix4(matrix4);
        console.log('Applied 4x4 transformation matrix for:', imageName);
      } else {
        // Fallback positioning
        console.log('Using fallback positioning for:', imageName);
        frustumGroup.position.set(position[0], position[1], position[2]);
        
        if (rotationMatrix && rotationMatrix.length >= 9) {
          const rotMatrix = new THREE.Matrix3();
          rotMatrix.set(
            rotationMatrix[0], rotationMatrix[1], rotationMatrix[2],
            rotationMatrix[3], rotationMatrix[4], rotationMatrix[5], 
            rotationMatrix[6], rotationMatrix[7], rotationMatrix[8]
          );
          
          const euler = new THREE.Euler();
          euler.setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(rotMatrix));
          frustumGroup.rotation.copy(euler);
        }
      }
      
      // Apply scale factor - similar to SCALEIMG in potree-sfm
      const SCALE_FACTOR = 3.0;
      frustumGroup.scale.setScalar(SCALE_FACTOR);
      
      // Store metadata
      frustumGroup.userData = {
        imageName: imageName,
        imageURL: imageURL,
        type: 'imageFrustum'
      };
      
      console.log(`Image frustum created for: ${imageName}`);
      return frustumGroup;
      
    } catch (error) {
      console.error('Error creating image frustum:', error);
      return null;
    }
  }

  /**
   * Create main image plane for detailed viewing
   */
  createImagePlane() {
    if (this.cameras.length === 0) return;

    const firstCamera = this.cameras[0];
    this.imageplane = this.createImageFrustum(
      this.options.imageDir,
      firstCamera.imageName, // Use imageName instead of label
      firstCamera.rotationMatrix,
      firstCamera.position,
      firstCamera.transform4x4
    );

    if (this.imageplane) {
      this.imageplane.visible = false;
      this.scene.add(this.imageplane);
      console.log(`Created image plane for: ${firstCamera.imageName}`);
    }
  }

  /**
   * Change the current image plane to show a different camera
   */
  changeImagePlane(cameraId) {
    if (!this.imageplane || cameraId >= this.cameras.length) return;

    const camera = this.cameras[cameraId];
    const imageGroup = this.imageplane;
    
    // Update texture
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    const imageURL = this.getImageURL(this.options.imageDir, camera.imageName); // Use imageName
    const newTexture = loader.load(imageURL,
      (texture) => {
        console.log(`✅ Successfully loaded full-size image: ${imageURL}`);
      },
      (progress) => {
        console.log(`Loading progress for ${imageURL}:`, progress);
      },
      (error) => {
        console.error(`❌ Failed to load full-size image: ${imageURL}`, error);
      }
    );
    
    const imagePlane = imageGroup.children.find(child => child.material && child.material.map);
    if (imagePlane) {
      imagePlane.material.map.dispose();
      imagePlane.material.map = newTexture;
    }

    // Update position and rotation using 4x4 matrix if available
    if (camera.transform4x4 && camera.transform4x4.length >= 16) {
      const matrix4 = new THREE.Matrix4();
      matrix4.set(
        camera.transform4x4[0], camera.transform4x4[1], camera.transform4x4[2], camera.transform4x4[3],
        camera.transform4x4[4], camera.transform4x4[5], camera.transform4x4[6], camera.transform4x4[7],
        camera.transform4x4[8], camera.transform4x4[9], camera.transform4x4[10], camera.transform4x4[11],
        camera.transform4x4[12], camera.transform4x4[13], camera.transform4x4[14], camera.transform4x4[15]
      );
      
      // Reset transform and apply the new matrix
      imageGroup.matrix.identity();
      imageGroup.applyMatrix4(matrix4);
    } else {
      // Fallback to position and rotation
      imageGroup.position.set(camera.position[0], camera.position[1], camera.position[2]);
      
      if (camera.rotationMatrix) {
        const rotMatrix = new THREE.Matrix3();
        rotMatrix.set(
          camera.rotationMatrix[0], camera.rotationMatrix[1], camera.rotationMatrix[2],
          camera.rotationMatrix[3], camera.rotationMatrix[4], camera.rotationMatrix[5],
          camera.rotationMatrix[6], camera.rotationMatrix[7], camera.rotationMatrix[8]
        );
        
        const euler = new THREE.Euler();
        euler.setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(rotMatrix));
        imageGroup.rotation.copy(euler);
      }
    }

    imageGroup.visible = true;
    this.currentCameraId = cameraId;
    
    console.log(`Changed image plane to camera ${cameraId}: ${camera.imageName}`);
  }

  /**
   * Fly to camera position
   */
  flyToCamera(cameraId) {
    if (cameraId >= this.cameras.length) return;

    const camera = this.cameras[cameraId];
    
    // Hide current image plane
    if (this.imageplane) {
      this.imageplane.visible = false;
    }

    // Position viewer camera near the SFM camera
    const view = this.viewer.scene.view;
    const offset = 2; // Distance from camera
    
    view.position.x = camera.position[0] + offset;
    view.position.y = camera.position[1] + offset;
    view.position.z = camera.position[2] + offset;

    // Look towards the camera direction
    const targetPos = new THREE.Vector3(
      camera.position[0],
      camera.position[1], 
      camera.position[2]
    );
    view.lookAt(targetPos);

    // Show the camera's image plane
    this.changeImagePlane(cameraId);
    
    this.activeCameraPlane = true;
    this.currentCameraId = cameraId;
    
    console.log(`Flew to camera ${cameraId}: ${camera.label}`);
  }

  /**
   * Toggle camera frustums visibility
   */
  toggleCameraFrustums() {
    this.cameraObjects.forEach(obj => {
      obj.visible = !obj.visible;
    });
    return this.cameraObjects.length > 0 ? this.cameraObjects[0].visible : false;
  }

  /**
   * Toggle image plane visibility
   */
  toggleImagePlane() {
    if (this.imageplane) {
      this.imageplane.visible = !this.imageplane.visible;
      this.activeCameraPlane = this.imageplane.visible;
      return this.imageplane.visible;
    }
    return false;
  }

  /**
   * Check if camera has moved and hide image plane if necessary
   */
  checkMovement() {
    if (!this.activeCameraPlane || !this.imageplane) return;

    const currentPos = this.getCurrentPosition();
    const moved = Math.abs(currentPos[0] - this.lastPosition[0]) > 0.01 ||
                  Math.abs(currentPos[1] - this.lastPosition[1]) > 0.01 ||
                  Math.abs(currentPos[2] - this.lastPosition[2]) > 0.01;

    if (moved) {
      this.imageplane.visible = false;
      this.activeCameraPlane = false;
      
      // Show all camera frustums when leaving detailed view
      this.cameraObjects.forEach(obj => {
        obj.visible = this.options.showFrustums;
      });
    }

    this.lastPosition = currentPos;
  }

  /**
   * Get current viewer position
   */
  getCurrentPosition() {
    const pos = this.viewer.scene.view.position;
    return [pos.x, pos.y, pos.z];
  }

  /**
   * Load from Google Cloud Storage
   */
  async loadFromGoogleCloud(bucketURL, datasetName) {
    try {
      // Construct URLs for different data files
      const cameraURL = `${bucketURL}/${datasetName}.cams.xml`;
      const metaURL = `${bucketURL}/${datasetName}.meta.json`;
      
      // Update base URL for images
      this.options.baseURL = bucketURL;
      
      // Load camera data
      await this.loadCameraData(cameraURL);
      
      console.log(`Loaded SFM data from Google Cloud: ${datasetName}`);
      return true;
    } catch (error) {
      console.error('Error loading from Google Cloud:', error);
      return false;
    }
  }

  /**
   * Filter cameras based on a look-at point
   */
  filterCamerasByLookAt(lookAtPoint) {
    this.lookAtPoint = lookAtPoint;
    this.filterImages = true;

    // Hide cameras that don't see the look-at point
    this.cameraObjects.forEach((obj, index) => {
      const camera = this.cameras[index];
      const inView = this.isPointInCamera(lookAtPoint, camera);
      obj.visible = this.options.showFrustums && inView;
    });
  }

  /**
   * Check if a point is visible from a camera (simplified)
   */
  isPointInCamera(point, camera) {
    // This is a simplified check - you might want to implement proper
    // frustum culling based on camera parameters
    const camPos = new THREE.Vector3(...camera.position);
    const pointVec = new THREE.Vector3(...point);
    const distance = camPos.distanceTo(pointVec);
    
    // Simple distance-based filter (adjust as needed)
    return distance < 100; // 100 units
  }

  /**
   * Clear all camera objects from scene
   */
  dispose() {
    this.cameraObjects.forEach(obj => {
      this.scene.remove(obj);
      obj.traverse(child => {
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
        if (child.geometry) child.geometry.dispose();
      });
    });
    
    if (this.imageplane) {
      this.scene.remove(this.imageplane);
      this.imageplane.traverse(child => {
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
        if (child.geometry) child.geometry.dispose();
      });
    }
    
    this.cameraObjects = [];
    this.cameras = [];
    this.imageplane = null;
  }
}

// Export for use in HTML
window.SFMCameraOverlay = SFMCameraOverlay;
