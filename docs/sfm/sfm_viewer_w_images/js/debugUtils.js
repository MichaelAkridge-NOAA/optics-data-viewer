/**
 * Debugging utilities for SFM Camera Overlay
 * Helps identify coordinate system and interaction issues
 */

class SFMDebugUtils {
  constructor(cameraOverlay, viewer) {
    this.cameraOverlay = cameraOverlay;
    this.viewer = viewer;
    this.debugObjects = [];
  }
  
  /**
   * Create visual debug helpers in the scene
   */
  createDebugHelpers() {
    this.clearDebugHelpers();
    
    if (!this.cameraOverlay || !this.cameraOverlay.cameras.length) {
      console.warn('No cameras available for debug visualization');
      return;
    }
    
    // Create coordinate system axes at origin
    const axesHelper = new THREE.AxesHelper(10);
    this.viewer.scene.scene.add(axesHelper);
    this.debugObjects.push(axesHelper);
    
    // Create point cloud bounding box visualization
    const pointClouds = this.viewer.scene.scene.children.filter(child => 
      child.type === 'Points' || (child.userData && child.userData.type === 'pointcloud')
    );
    
    if (pointClouds.length > 0) {
      const boundingBox = new THREE.Box3();
      pointClouds.forEach(pc => boundingBox.expandByObject(pc));
      
      const boxHelper = new THREE.Box3Helper(boundingBox, 0xffff00);
      this.viewer.scene.scene.add(boxHelper);
      this.debugObjects.push(boxHelper);
      
      console.log('📦 Point Cloud Bounding Box:', {
        min: boundingBox.min.toArray().map(n => n.toFixed(2)),
        max: boundingBox.max.toArray().map(n => n.toFixed(2)),
        center: boundingBox.getCenter(new THREE.Vector3()).toArray().map(n => n.toFixed(2)),
        size: boundingBox.getSize(new THREE.Vector3()).toArray().map(n => n.toFixed(2))
      });
    }
    
    // Create camera position visualization
    this.createCameraPositionDebug();
    
    console.log('🔧 Debug helpers created');
  }
  
  /**
   * Create visualization of camera positions as spheres
   */
  createCameraPositionDebug() {
    const geometry = new THREE.SphereGeometry(0.5, 8, 6);
    
    this.cameraOverlay.cameras.forEach((camera, index) => {
      // Color coding based on distance from origin
      const distance = Math.sqrt(
        camera.position[0] ** 2 + 
        camera.position[1] ** 2 + 
        camera.position[2] ** 2
      );
      
      let color = 0x00ff00; // Green for normal distance
      if (distance < 1) color = 0xff0000; // Red for too close
      else if (distance > 100) color = 0x0000ff; // Blue for too far
      else if (distance > 50) color = 0xffff00; // Yellow for far
      
      const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7 });
      const sphere = new THREE.Mesh(geometry, material);
      
      sphere.position.set(...camera.position);
      sphere.userData = { type: 'debug-camera', cameraIndex: index, camera: camera };
      
      this.viewer.scene.scene.add(sphere);
      this.debugObjects.push(sphere);
    });
    
    console.log(`🎥 Created ${this.cameraOverlay.cameras.length} camera position debug spheres`);
  }
  
  /**
   * Analyze click ray and intersection points
   */
  analyzeClickRay(clickEvent) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clickEvent.clientX - rect.left) / rect.width) * 2 - 1,
      -((clickEvent.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.viewer.scene.getActiveCamera());
    
    // Create visual ray
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      raycaster.ray.origin,
      raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(100))
    ]);
    const rayMaterial = new THREE.LineBasicMaterial({ color: 0xff00ff });
    const rayLine = new THREE.Line(rayGeometry, rayMaterial);
    
    rayLine.userData = { type: 'debug-ray', temporary: true };
    this.viewer.scene.scene.add(rayLine);
    this.debugObjects.push(rayLine);
    
    // Remove ray after 5 seconds
    setTimeout(() => {
      this.viewer.scene.scene.remove(rayLine);
      const index = this.debugObjects.indexOf(rayLine);
      if (index > -1) this.debugObjects.splice(index, 1);
    }, 5000);
    
    return {
      mouse: mouse,
      ray: raycaster.ray,
      origin: raycaster.ray.origin.toArray(),
      direction: raycaster.ray.direction.toArray()
    };
  }
  
  /**
   * Test camera-to-point visibility and create visual lines
   */
  testCameraVisibility(clickPoint) {
    this.clearTemporaryDebugObjects();
    
    if (!clickPoint) return;
    
    // Create click point marker
    const pointGeometry = new THREE.SphereGeometry(0.3, 16, 8);
    const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const pointMarker = new THREE.Mesh(pointGeometry, pointMaterial);
    pointMarker.position.copy(clickPoint);
    pointMarker.userData = { type: 'debug-click-point', temporary: true };
    
    this.viewer.scene.scene.add(pointMarker);
    this.debugObjects.push(pointMarker);
    
    // Create lines from nearest cameras to click point
    const nearestCameras = this.cameraOverlay.cameras
      .map((camera, index) => ({
        camera,
        index,
        distance: new THREE.Vector3(...camera.position).distanceTo(clickPoint)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5); // Top 5 closest cameras
    
    nearestCameras.forEach(({ camera, distance }, i) => {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...camera.position),
        clickPoint
      ]);
      
      // Color gradient from green (closest) to red (farthest)
      const hue = (i / nearestCameras.length) * 0.3; // 0 (red) to 0.3 (green)
      const color = new THREE.Color().setHSL(0.3 - hue, 1, 0.5);
      
      const lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      
      line.userData = { 
        type: 'debug-camera-line', 
        temporary: true, 
        cameraIndex: camera.index,
        distance: distance 
      };
      
      this.viewer.scene.scene.add(line);
      this.debugObjects.push(line);
    });
    
    console.log('🔍 Created visibility test lines for', nearestCameras.length, 'cameras');
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      this.clearTemporaryDebugObjects();
    }, 10000);
  }
  
  /**
   * Clear temporary debug objects
   */
  clearTemporaryDebugObjects() {
    const toRemove = this.debugObjects.filter(obj => obj.userData.temporary);
    toRemove.forEach(obj => {
      this.viewer.scene.scene.remove(obj);
      const index = this.debugObjects.indexOf(obj);
      if (index > -1) this.debugObjects.splice(index, 1);
    });
  }
  
  /**
   * Clear all debug helpers
   */
  clearDebugHelpers() {
    this.debugObjects.forEach(obj => {
      this.viewer.scene.scene.remove(obj);
    });
    this.debugObjects = [];
  }
  
  /**
   * Generate comprehensive debug report
   */
  generateDebugReport() {
    const report = {
      timestamp: new Date().toISOString(),
      viewer: {
        position: this.viewer.scene.view.position.toArray(),
        camera: this.viewer.scene.getActiveCamera().position.toArray()
      },
      cameras: {
        count: this.cameraOverlay.cameras.length,
        distribution: this.cameraOverlay.getCameraDistributionStats(),
        sample: this.cameraOverlay.cameras.slice(0, 5).map(cam => ({
          label: cam.label,
          position: cam.position,
          positionMagnitude: cam.positionMagnitude,
          issues: cam.coordinateSystem?.issues || []
        }))
      },
      scene: {
        objects: this.viewer.scene.scene.children.length,
        pointClouds: this.viewer.scene.scene.children.filter(child => 
          child.type === 'Points' || (child.userData && child.userData.type === 'pointcloud')
        ).length
      }
    };
    
    console.log('📋 SFM Debug Report:', report);
    return report;
  }
}

// Make available globally
window.SFMDebugUtils = SFMDebugUtils;