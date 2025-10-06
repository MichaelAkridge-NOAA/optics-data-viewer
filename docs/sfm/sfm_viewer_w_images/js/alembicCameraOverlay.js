/**
 * Alembic Camera Overlay for Enhanced SFM Viewer
 * Provides 3D visualization and interaction with Alembic camera data
 */

class AlembicCameraOverlay {
    constructor(viewer, options = {}) {
        this.viewer = viewer;
        this.scene = viewer.scene.scene;
        this.camera = viewer.scene.getActiveCamera();
        
        this.options = {
            showFrustums: true,
            showImagePlane: false,
            frustumScale: 1.0,
            frustumColor: 0x4CAF50,
            selectedColor: 0xFFD700,
            imagePlaneOpacity: 0.8,
            onCameraUpdate: null,
            onTimelineUpdate: null,
            ...options
        };

        this.cameras = [];
        this.cameraObjects = [];
        this.imagePlanes = [];
        this.currentFrame = 0;
        this.selectedCameraIndex = -1;
        this.alembicLoader = new AlembicLoader();

        this.frustumsVisible = this.options.showFrustums;
        this.imagePlanesVisible = this.options.showImagePlane;

        console.log('AlembicCameraOverlay initialized');
    }

    /**
     * Load Alembic file and create camera visualizations
     */
    async loadAlembicFile(file) {
        try {
            console.log('Loading Alembic file for camera overlay...');
            
            const alembicData = await this.alembicLoader.loadAlembicFile(file);
            this.cameras = alembicData.cameras;
            
            this.createCameraObjects();
            this.updateCameraPositions(this.currentFrame);
            
            if (this.options.onCameraUpdate) {
                this.options.onCameraUpdate(this.cameras);
            }
            
            console.log(`Loaded ${this.cameras.length} cameras from Alembic file`);
            return alembicData;
            
        } catch (error) {
            console.error('Error loading Alembic file:', error);
            throw error;
        }
    }

    /**
     * Load Alembic from URL
     */
    async loadAlembicFromURL(url) {
        try {
            console.log('Loading Alembic from URL for camera overlay...');
            
            const alembicData = await this.alembicLoader.loadAlembicFromURL(url);
            this.cameras = alembicData.cameras;
            
            this.createCameraObjects();
            this.updateCameraPositions(this.currentFrame);
            
            if (this.options.onCameraUpdate) {
                this.options.onCameraUpdate(this.cameras);
            }
            
            console.log(`Loaded ${this.cameras.length} cameras from URL`);
            return alembicData;
            
        } catch (error) {
            console.error('Error loading Alembic from URL:', error);
            throw error;
        }
    }

    /**
     * Create 3D objects for camera visualization
     */
    createCameraObjects() {
        console.log('Creating camera objects...');
        
        // Clear existing objects
        this.clearCameraObjects();
        
        this.cameras.forEach((camera, index) => {
            const cameraGroup = new THREE.Group();
            cameraGroup.name = `camera_${index}`;
            
            // Create camera frustum
            const frustum = this.createCameraFrustum(camera, index);
            cameraGroup.add(frustum);
            
            // Create image plane if needed
            if (this.options.showImagePlane) {
                const imagePlane = this.createImagePlane(camera, index);
                if (imagePlane) {
                    cameraGroup.add(imagePlane);
                    this.imagePlanes[index] = imagePlane;
                }
            }
            
            // Set initial visibility
            cameraGroup.visible = camera.visible && this.frustumsVisible;
            
            this.cameraObjects[index] = cameraGroup;
            this.scene.add(cameraGroup);
        });
        
        console.log(`Created ${this.cameraObjects.length} camera objects`);
    }

    /**
     * Create camera frustum visualization
     */
    createCameraFrustum(camera, index) {
        const keyframe = camera.keyframes[0] || {};
        const fov = keyframe.fov || 60;
        const aspect = (keyframe.filmWidth || 36) / (keyframe.filmHeight || 24);
        const near = keyframe.nearClip || 0.1;
        const far = Math.min(keyframe.farClip || 1000, 50); // Limit frustum size
        
        // Create frustum geometry
        const frustumGeometry = new THREE.CameraHelper(new THREE.PerspectiveCamera(fov, aspect, near, far));
        
        // Create frustum material
        const color = index === this.selectedCameraIndex ? this.options.selectedColor : this.options.frustumColor;
        const material = new THREE.LineBasicMaterial({ 
            color: color,
            transparent: true,
            opacity: 0.8
        });
        
        const frustum = new THREE.LineSegments(frustumGeometry.geometry, material);
        frustum.name = `frustum_${index}`;
        
        // Scale frustum for better visibility
        frustum.scale.setScalar(this.options.frustumScale);
        
        return frustum;
    }

    /**
     * Create image plane for camera
     */
    createImagePlane(camera, index) {
        const keyframe = camera.keyframes[0] || {};
        const aspect = (keyframe.filmWidth || 36) / (keyframe.filmHeight || 24);
        
        // Create plane geometry
        const width = 2;
        const height = width / aspect;
        const geometry = new THREE.PlaneGeometry(width, height);
        
        // Create material (placeholder for now)
        const material = new THREE.MeshBasicMaterial({
            color: 0x888888,
            transparent: true,
            opacity: this.options.imagePlaneOpacity,
            side: THREE.DoubleSide
        });
        
        const plane = new THREE.Mesh(geometry, material);
        plane.name = `imageplane_${index}`;
        
        // Position plane in front of camera
        const distance = 5;
        plane.position.set(0, 0, -distance);
        
        return plane;
    }

    /**
     * Update camera positions for specific frame
     */
    updateCameraPositions(frame) {
        this.currentFrame = frame;
        
        this.cameras.forEach((camera, index) => {
            const cameraObject = this.cameraObjects[index];
            if (!cameraObject) return;
            
            const keyframe = this.interpolateKeyframe(camera, frame);
            if (!keyframe) return;
            
            // Update position
            cameraObject.position.fromArray(keyframe.position);
            
            // Update rotation
            if (keyframe.target) {
                const target = new THREE.Vector3().fromArray(keyframe.target);
                cameraObject.lookAt(target);
            } else if (keyframe.rotation) {
                cameraObject.rotation.fromArray(keyframe.rotation.map(deg => deg * Math.PI / 180));
            }
            
            // Update frustum scale based on FOV changes
            const frustum = cameraObject.getObjectByName(`frustum_${index}`);
            if (frustum && keyframe.fov) {
                const scale = Math.tan((keyframe.fov * Math.PI / 180) / 2) * this.options.frustumScale;
                frustum.scale.setScalar(scale);
            }
        });
        
        if (this.options.onTimelineUpdate) {
            this.options.onTimelineUpdate({
                currentFrame: frame,
                totalFrames: this.getTotalFrames()
            });
        }
    }

    /**
     * Interpolate keyframe data for given frame
     */
    interpolateKeyframe(camera, frame) {
        if (!camera.keyframes || camera.keyframes.length === 0) {
            return null;
        }
        
        // If not animated, return first keyframe
        if (!camera.isAnimated || camera.keyframes.length === 1) {
            return camera.keyframes[0];
        }
        
        // Find surrounding keyframes
        let keyframe1 = camera.keyframes[0];
        let keyframe2 = camera.keyframes[camera.keyframes.length - 1];
        
        for (let i = 0; i < camera.keyframes.length - 1; i++) {
            if (camera.keyframes[i].frame <= frame && camera.keyframes[i + 1].frame >= frame) {
                keyframe1 = camera.keyframes[i];
                keyframe2 = camera.keyframes[i + 1];
                break;
            }
        }
        
        // If frame is exact match, return that keyframe
        if (keyframe1.frame === frame) return keyframe1;
        if (keyframe2.frame === frame) return keyframe2;
        
        // Interpolate between keyframes
        const t = (frame - keyframe1.frame) / (keyframe2.frame - keyframe1.frame);
        
        return {
            frame: frame,
            time: this.lerp(keyframe1.time, keyframe2.time, t),
            position: this.lerpArray(keyframe1.position, keyframe2.position, t),
            target: keyframe1.target && keyframe2.target ? 
                this.lerpArray(keyframe1.target, keyframe2.target, t) : 
                (keyframe1.target || keyframe2.target),
            rotation: keyframe1.rotation && keyframe2.rotation ? 
                this.lerpArray(keyframe1.rotation, keyframe2.rotation, t) : 
                (keyframe1.rotation || keyframe2.rotation),
            fov: this.lerp(keyframe1.fov, keyframe2.fov, t),
            nearClip: this.lerp(keyframe1.nearClip, keyframe2.nearClip, t),
            farClip: this.lerp(keyframe1.farClip, keyframe2.farClip, t),
            filmWidth: this.lerp(keyframe1.filmWidth, keyframe2.filmWidth, t),
            filmHeight: this.lerp(keyframe1.filmHeight, keyframe2.filmHeight, t),
            focalLength: this.lerp(keyframe1.focalLength, keyframe2.focalLength, t)
        };
    }

    /**
     * Linear interpolation helper
     */
    lerp(a, b, t) {
        return a + (b - a) * Math.max(0, Math.min(1, t));
    }

    /**
     * Array linear interpolation helper
     */
    lerpArray(a, b, t) {
        if (!a || !b) return a || b;
        return a.map((val, i) => this.lerp(val, b[i] || 0, t));
    }

    /**
     * Set current frame and update positions
     */
    setFrame(frame) {
        this.updateCameraPositions(frame);
    }

    /**
     * Toggle camera frustum visibility
     */
    toggleCameraFrustums() {
        this.frustumsVisible = !this.frustumsVisible;
        
        this.cameraObjects.forEach((cameraObject, index) => {
            if (cameraObject) {
                const frustum = cameraObject.getObjectByName(`frustum_${index}`);
                if (frustum) {
                    frustum.visible = this.frustumsVisible && this.cameras[index].visible;
                }
            }
        });
        
        return this.frustumsVisible;
    }

    /**
     * Toggle image plane visibility
     */
    toggleImagePlane() {
        this.imagePlanesVisible = !this.imagePlanesVisible;
        
        this.cameraObjects.forEach((cameraObject, index) => {
            if (cameraObject) {
                const imagePlane = cameraObject.getObjectByName(`imageplane_${index}`);
                if (imagePlane) {
                    imagePlane.visible = this.imagePlanesVisible && this.cameras[index].visible;
                }
            }
        });
        
        return this.imagePlanesVisible;
    }

    /**
     * Fly to specific camera
     */
    flyToCamera(index, frame = null) {
        if (index < 0 || index >= this.cameras.length) {
            console.warn('Invalid camera index:', index);
            return;
        }
        
        const camera = this.cameras[index];
        const targetFrame = frame !== null ? frame : this.currentFrame;
        const keyframe = this.interpolateKeyframe(camera, targetFrame);
        
        if (!keyframe) {
            console.warn('No keyframe data for camera:', index);
            return;
        }
        
        console.log(`Flying to camera ${index} at frame ${targetFrame}`);
        
        // Update selection
        this.selectCamera(index);
        
        // Animate camera to position
        const startPos = this.camera.position.clone();
        const targetPos = new THREE.Vector3().fromArray(keyframe.position);
        
        const startTime = Date.now();
        const duration = 2000; // 2 seconds
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Smooth easing
            const t = progress < 0.5 ? 
                2 * progress * progress : 
                1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            // Interpolate position
            this.camera.position.lerpVectors(startPos, targetPos, t);
            
            // Look at target if available
            if (keyframe.target) {
                const target = new THREE.Vector3().fromArray(keyframe.target);
                this.camera.lookAt(target);
            }
            
            // Update FOV
            if (keyframe.fov) {
                this.camera.fov = this.lerp(this.camera.fov, keyframe.fov, t * 0.5);
                this.camera.updateProjectionMatrix();
            }
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                console.log('Camera flight completed');
            }
        };
        
        animate();
    }

    /**
     * Select camera (highlight)
     */
    selectCamera(index) {
        // Deselect previous camera
        if (this.selectedCameraIndex >= 0) {
            const prevCamera = this.cameraObjects[this.selectedCameraIndex];
            if (prevCamera) {
                const frustum = prevCamera.getObjectByName(`frustum_${this.selectedCameraIndex}`);
                if (frustum && frustum.material) {
                    frustum.material.color.setHex(this.options.frustumColor);
                }
            }
        }
        
        // Select new camera
        this.selectedCameraIndex = index;
        if (index >= 0 && index < this.cameraObjects.length) {
            const cameraObject = this.cameraObjects[index];
            if (cameraObject) {
                const frustum = cameraObject.getObjectByName(`frustum_${index}`);
                if (frustum && frustum.material) {
                    frustum.material.color.setHex(this.options.selectedColor);
                }
            }
        }
    }

    /**
     * Toggle individual camera visibility
     */
    toggleCameraVisibility(index) {
        if (index < 0 || index >= this.cameras.length) return;
        
        this.cameras[index].visible = !this.cameras[index].visible;
        const cameraObject = this.cameraObjects[index];
        
        if (cameraObject) {
            cameraObject.visible = this.cameras[index].visible;
        }
    }

    /**
     * Fit all cameras to view
     */
    fitCamerasToView() {
        if (this.cameras.length === 0) return;
        
        const box = new THREE.Box3();
        
        this.cameras.forEach((camera, index) => {
            const keyframe = this.interpolateKeyframe(camera, this.currentFrame);
            if (keyframe && keyframe.position) {
                box.expandByPoint(new THREE.Vector3().fromArray(keyframe.position));
            }
        });
        
        if (!box.isEmpty()) {
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            const distance = maxDim * 2;
            this.camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance));
            this.camera.lookAt(center);
            
            console.log('Fitted cameras to view');
        }
    }

    /**
     * Get total number of frames across all cameras
     */
    getTotalFrames() {
        let maxFrame = 1;
        this.cameras.forEach(camera => {
            if (camera.keyframes) {
                camera.keyframes.forEach(kf => {
                    maxFrame = Math.max(maxFrame, kf.frame + 1);
                });
            }
        });
        return maxFrame;
    }

    /**
     * Clear all camera objects from scene
     */
    clearCameraObjects() {
        this.cameraObjects.forEach(obj => {
            if (obj && obj.parent) {
                obj.parent.remove(obj);
            }
        });
        this.cameraObjects = [];
        this.imagePlanes = [];
    }

    /**
     * Dispose of resources
     */
    dispose() {
        console.log('Disposing AlembicCameraOverlay...');
        
        this.clearCameraObjects();
        this.cameras = [];
        this.selectedCameraIndex = -1;
        this.currentFrame = 0;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlembicCameraOverlay;
} else {
    window.AlembicCameraOverlay = AlembicCameraOverlay;
}