#!/usr/bin/env python3
"""
Build index for optical products using gsutil instead of google-cloud-storage library.
This avoids authentication issues.
"""

import json, re, subprocess, sys, logging, time, tempfile, os
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
import argparse

# Image processing for thumbnails
try:
    import rasterio
    from rasterio.warp import transform_bounds
    import rasterio.windows
    import matplotlib.pyplot as plt
    import numpy as np
    from PIL import Image
    HAS_RASTERIO = True
except ImportError:
    print("Warning: rasterio, matplotlib, or PIL not available. Thumbnail generation will be disabled.")
    HAS_RASTERIO = False

# Memory / size safety caps
# Maximum number of output pixels (height * width) for previews to read into memory
# This keeps the array size bounded; tune based on your machine (e.g., 2e6 ~ 2 megapixels)
MAX_PREVIEW_PIXELS = 2_000_000
# Maximum number of pixels to sample for statistics calculations
SAMPLE_PIXELS = 200_000

# Product type patterns
PRODUCT_PATTERNS = {
    'dem': [
        r'.*_dem\.tif$',
        r'.*_DEM\.tif$',
        r'.*DEM\.tif$'
    ],
    'ortho': [
        r'.*_mos\.tif$',
        r'.*_Orthomosaic\.tif$',
        r'.*Orthomosaic\.tif$',
        r'.*_Orthophoto\.tif$',
        r'.*Orthophoto\.tif$'
    ]
}

# Region configurations
REGION_CONFIGS = {
    'marianas': {
        'name': 'Mariana Islands',
        'code': 'MARI',
        'gcs_prefix': 'gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/Fixed_Sites_Projects/Vital_Rates/MARAMP22/Orthomosaic_DEM',
        'islands': ['MAU', 'ASC', 'GUA', 'PAG', 'SAI']
    },
    'american-samoa': {
        'name': 'American Samoa',
        'code': 'AMSM', 
        'gcs_prefix': 'gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/Fixed_Sites_Projects/Vital_Rates/AMSAMOA/Orthomosaic_DEM',
        'islands': ['OFU', 'ROS', 'TAU', 'TUT']
    },
    'pria': {
        'name': 'Pacific Remote Islands',
        'code': 'PRIA',
        'gcs_prefix': 'gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/Fixed_Sites_Projects/Vital_Rates/PRIA/Orthomosaic_DEM', 
        'islands': ['BAK', 'HOW']
    }
}

def setup_logger(level: str = "INFO"):
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

def safe_id(text: str) -> str:
    """Create safe ID from text."""
    return re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()

def human_bytes(n: int) -> str:
    """Convert bytes to human readable format."""
    units = ["B","KB","MB","GB","TB","PB"]
    val = float(n or 0)
    i = 0
    while val >= 1024 and i < len(units)-1:
        val /= 1024.0
        i += 1
    return f"{val:.2f} {units[i]}"

def gs_to_https(gs_uri: str) -> str:
    """Convert gs:// URI to https:// URL."""
    if gs_uri.startswith("gs://"):
        b_and_k = gs_uri[5:]
        bucket, key = b_and_k.split("/", 1)
        return f"https://storage.googleapis.com/{bucket}/{key}"
    return gs_uri

def download_gcs_file(gcs_path: str, local_path: str) -> bool:
    """Download a file from GCS using gsutil."""
    try:
        cmd = f'gsutil cp "{gcs_path}" "{local_path}"'
        logging.debug(f"Downloading: {cmd}")
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, check=True)
        return os.path.exists(local_path)
    except subprocess.CalledProcessError as e:
        logging.error(f"Failed to download {gcs_path}: {e}")
        return False
    except Exception as e:
        logging.error(f"Error downloading {gcs_path}: {e}")
        return False

def diagnose_tif(tif_path: str) -> dict:
    """Diagnose TIF file properties and extract comprehensive metadata."""
    try:
        with rasterio.open(tif_path) as src:
            info = {
                'bands': src.count,
                'width': src.width,
                'height': src.height,
                'dtype': str(src.dtypes[0]) if src.dtypes else 'unknown',
                'nodata': src.nodata,
                'file_size_mb': round(os.path.getsize(tif_path) / (1024*1024), 2)
            }
            
            # Coordinate Reference System details
            if src.crs:
                try:
                    info['crs'] = {
                        'wkt': str(src.crs) if src.crs else 'unknown',
                        'epsg': None,
                        'proj4': 'unknown', 
                        'authority': 'unknown',
                        'units': 'unknown'
                    }
                    
                    # Safely try to get EPSG
                    try:
                        epsg = src.crs.to_epsg()
                        info['crs']['epsg'] = epsg
                    except:
                        pass
                    
                    # Safely try to get proj4
                    try:
                        if hasattr(src.crs, 'to_proj4'):
                            info['crs']['proj4'] = src.crs.to_proj4()
                        elif hasattr(src.crs, 'to_string'):
                            info['crs']['proj4'] = src.crs.to_string()
                    except:
                        pass
                    
                    # Safely try to get authority
                    try:
                        if hasattr(src.crs, 'to_authority'):
                            auth = src.crs.to_authority()
                            info['crs']['authority'] = f"{auth[0]}:{auth[1]}" if auth else 'unknown'
                    except:
                        pass
                    
                    # Safely try to get units
                    try:
                        if hasattr(src.crs, 'linear_units'):
                            info['crs']['units'] = src.crs.linear_units
                        elif hasattr(src.crs, 'linear_units_factor'):
                            factor = src.crs.linear_units_factor[1]
                            if factor == 1.0:
                                info['crs']['units'] = 'meter'
                            elif abs(factor - 0.3048) < 0.001:
                                info['crs']['units'] = 'foot'
                            else:
                                info['crs']['units'] = f'unknown_factor_{factor}'
                    except:
                        pass
                        
                except Exception as e:
                    info['crs'] = {'error': f'CRS parsing failed: {str(e)}'}
            
            # Geotransform and spatial resolution
            try:
                if src.transform and src.transform != rasterio.Affine.identity():
                    transform = src.transform
                    info['geotransform'] = {
                        'pixel_size_x': abs(transform.a) if transform.a != 0 else 'unknown',
                        'pixel_size_y': abs(transform.e) if transform.e != 0 else 'unknown',  
                        'rotation_x': transform.b if hasattr(transform, 'b') else 0,
                        'rotation_y': transform.d if hasattr(transform, 'd') else 0,
                        'origin_x': transform.c if hasattr(transform, 'c') else 'unknown',
                        'origin_y': transform.f if hasattr(transform, 'f') else 'unknown',
                        'transform_array': list(transform)[:6] if transform else None
                    }
                    
                    # Calculate area coverage - only if we have valid pixel sizes
                    try:
                        if (isinstance(info['geotransform']['pixel_size_x'], (int, float)) and 
                            isinstance(info['geotransform']['pixel_size_y'], (int, float))):
                            area_sq_meters = (abs(transform.a) * abs(transform.e) * 
                                            src.width * src.height)
                            info['coverage'] = {
                                'area_sq_meters': round(area_sq_meters, 2),
                                'area_sq_km': round(area_sq_meters / 1_000_000, 6),
                                'area_hectares': round(area_sq_meters / 10_000, 4)
                            }
                        else:
                            info['coverage'] = {'error': 'Cannot calculate - invalid pixel size'}
                    except:
                        info['coverage'] = {'error': 'Area calculation failed'}
                else:
                    info['geotransform'] = {'error': 'No valid geotransform found'}
                    info['coverage'] = {'error': 'No geotransform available'}
            except Exception as e:
                info['geotransform'] = {'error': f'Transform parsing failed: {str(e)}'}
                info['coverage'] = {'error': 'Transform parsing failed'}
            
            # Geographic bounds in different formats
            try:
                if hasattr(src, 'bounds') and src.bounds:
                    bounds = src.bounds
                    if all(b is not None and not (isinstance(b, float) and (np.isnan(b) or np.isinf(b))) 
                           for b in [bounds.left, bounds.bottom, bounds.right, bounds.top]):
                        info['bounds'] = {
                            'left': bounds.left,
                            'bottom': bounds.bottom, 
                            'right': bounds.right,
                            'top': bounds.top,
                            'width': bounds.right - bounds.left,
                            'height': bounds.top - bounds.bottom
                        }
                        
                        # Convert to geographic coordinates (lat/lon) if not already
                        try:
                            if src.crs:
                                from rasterio.warp import transform_bounds
                                geo_bounds = transform_bounds(src.crs, 'EPSG:4326', *bounds)
                                if all(isinstance(b, (int, float)) and not (np.isnan(b) or np.isinf(b)) 
                                       for b in geo_bounds):
                                    info['bounds_wgs84'] = {
                                        'west': geo_bounds[0],
                                        'south': geo_bounds[1],
                                        'east': geo_bounds[2], 
                                        'north': geo_bounds[3],
                                        'center_lon': (geo_bounds[0] + geo_bounds[2]) / 2,
                                        'center_lat': (geo_bounds[1] + geo_bounds[3]) / 2
                                    }
                                else:
                                    info['bounds_wgs84'] = {'error': 'Invalid transformed coordinates'}
                            else:
                                info['bounds_wgs84'] = {'error': 'No CRS for coordinate transformation'}
                        except Exception as e:
                            info['bounds_wgs84'] = {'error': f'Coordinate transformation failed: {str(e)}'}
                    else:
                        info['bounds'] = {'error': 'Invalid bounds values (NaN/Inf detected)'}
                        info['bounds_wgs84'] = {'error': 'Invalid source bounds'}
                else:
                    info['bounds'] = {'error': 'No bounds available'}
                    info['bounds_wgs84'] = {'error': 'No bounds available'}
            except Exception as e:
                info['bounds'] = {'error': f'Bounds extraction failed: {str(e)}'}
                info['bounds_wgs84'] = {'error': 'Bounds extraction failed'}
            
            # Compression and internal structure
            try:
                info['compression'] = getattr(src.compression, 'name', 'unknown') if hasattr(src, 'compression') and src.compression else 'none'
            except:
                info['compression'] = 'unknown'
                
            try:
                info['interleave'] = getattr(src.interleave, 'name', 'unknown') if hasattr(src, 'interleave') and src.interleave else 'unknown'
            except:
                info['interleave'] = 'unknown'
                
            try:
                info['tiled'] = src.is_tiled if hasattr(src, 'is_tiled') else 'unknown'
            except:
                info['tiled'] = 'unknown'
                
            try:
                if hasattr(src, 'block_shapes') and src.block_shapes:
                    info['block_size'] = src.block_shapes[0] if len(src.block_shapes) > 0 else 'unknown'
                else:
                    info['block_size'] = 'unknown'
            except:
                info['block_size'] = 'unknown'
            
            # Overviews (pyramids)
            try:
                info['overviews'] = []
                if hasattr(src, 'count') and src.count > 0:
                    for i in range(src.count):
                        try:
                            overview_count = src.overviews(i + 1) if hasattr(src, 'overviews') else []
                            if overview_count:
                                info['overviews'].append({
                                    'band': i + 1,
                                    'levels': len(overview_count),
                                    'factors': list(overview_count)
                                })
                        except Exception as e:
                            logging.debug(f"Failed to get overviews for band {i+1}: {e}")
                            continue
                else:
                    info['overviews'] = {'error': 'No bands available'}
            except Exception as e:
                info['overviews'] = {'error': f'Overview extraction failed: {str(e)}'}
            
            # Color interpretation for RGB data
            try:
                if hasattr(src, 'count') and src.count >= 3:
                    try:
                        if hasattr(src, 'colorinterp') and src.colorinterp:
                            color_interp = []
                            for i in range(min(4, src.count)):
                                try:
                                    interp_name = getattr(src.colorinterp[i], 'name', 'unknown')
                                    color_interp.append(interp_name)
                                except:
                                    color_interp.append('unknown')
                            info['color_interpretation'] = color_interp
                        else:
                            info['color_interpretation'] = ['unknown'] * min(4, src.count)
                    except Exception as e:
                        info['color_interpretation'] = {'error': f'Color interpretation failed: {str(e)}'}
                else:
                    info['color_interpretation'] = 'N/A (< 3 bands)'
            except Exception as e:
                info['color_interpretation'] = {'error': f'Color interpretation check failed: {str(e)}'}
            
            # Metadata tags
            try:
                if hasattr(src, 'tags'):
                    tags = src.tags()
                    if tags and isinstance(tags, dict):
                        # Filter out very long or binary metadata
                        filtered_tags = {}
                        for key, value in tags.items():
                            try:
                                if isinstance(value, str) and len(value) < 200:
                                    filtered_tags[key] = value
                                elif value is not None and str(value) != 'None':
                                    # Convert non-string values to string if reasonable length
                                    str_value = str(value)[:200] if str(value) else ''
                                    if str_value:
                                        filtered_tags[key] = str_value
                            except:
                                continue  # Skip problematic tags
                        info['metadata_tags'] = filtered_tags if filtered_tags else 'none'
                    else:
                        info['metadata_tags'] = 'none'
                else:
                    info['metadata_tags'] = 'not available'
            except Exception as e:
                info['metadata_tags'] = {'error': f'Metadata extraction failed: {str(e)}'}
            
            # Band statistics - sample some data to check ranges
            try:
                info['band_stats'] = {}
                if hasattr(src, 'width') and hasattr(src, 'height') and hasattr(src, 'count'):
                    # Compute a sample out_shape that stays under SAMPLE_PIXELS
                    try:
                        height = src.height
                        width = src.width
                        sample_target = max(1000, SAMPLE_PIXELS)
                        sample_scale = max(1.0, (height * width) / sample_target)
                        sample_h = max(1, int(height / (sample_scale ** 0.5)))
                        sample_w = max(1, int(width / (sample_scale ** 0.5)))
                        logging.info(f"Sampling for stats - reading sample size {sample_w}x{sample_h} (approx {sample_w*sample_h} pixels)")
                        sample_data = src.read(out_shape=(src.count, sample_h, sample_w))
                    except Exception as e:
                        info['band_stats'] = {'error': f'Data sampling failed: {str(e)}'}
                    else:
                        for i in range(min(5, src.count)):  # Limit to first 5 bands
                            try:
                                band_data = sample_data[i] if sample_data.ndim > 2 else sample_data

                                # Handle no-data values
                                try:
                                    if hasattr(src, 'nodata') and src.nodata is not None:
                                        valid_data = band_data[band_data != src.nodata]
                                    else:
                                        valid_data = band_data[~np.isnan(band_data)]
                                except Exception:
                                    valid_data = band_data

                                if valid_data.size > 0:
                                    try:
                                        info['band_stats'][f'band_{i+1}'] = {
                                            'min': float(np.min(valid_data)),
                                            'max': float(np.max(valid_data)),
                                            'mean': float(np.mean(valid_data)),
                                            'std': float(np.std(valid_data)),
                                            'percentile_2': float(np.percentile(valid_data, 2)),
                                            'percentile_98': float(np.percentile(valid_data, 98)),
                                            'valid_pixels': int(valid_data.size),
                                            'total_pixels': int(band_data.size)
                                        }
                                    except Exception as e:
                                        info['band_stats'][f'band_{i+1}'] = {'error': f'Stats calculation failed: {str(e)}'}
                                else:
                                    info['band_stats'][f'band_{i+1}'] = {
                                        'min': None, 'max': None, 'mean': None, 'std': None,
                                        'percentile_2': None, 'percentile_98': None,
                                        'valid_pixels': 0, 'total_pixels': int(band_data.size) if 'band_data' in locals() else 0
                                    }
                            except Exception as e:
                                info['band_stats'][f'band_{i+1}'] = {'error': f'Band {i+1} processing failed: {str(e)}'}
                                continue
                else:
                    info['band_stats'] = {'error': 'Image dimensions not available'}
            except Exception as e:
                info['band_stats'] = {'error': f'Band statistics extraction failed: {str(e)}'}
            
            return info
    except Exception as e:
        return {'error': str(e)}

def create_thumbnail(tif_path: str, output_path: str, max_size: Tuple[int, int] = (512, 512)) -> bool:
    """Create PNG thumbnail from TIF file."""
    if not HAS_RASTERIO:
        logging.warning("Rasterio not available, skipping thumbnail generation")
        return False
        
    try:
        # Diagnose the file first
        diag = diagnose_tif(tif_path)
        logging.debug(f"TIF diagnosis: {diag}")
        
        with rasterio.open(tif_path) as src:
            # Log original file dimensions
            logging.info(f"TIF dimensions: {src.width}x{src.height}, bands: {src.count}")

            # Determine safe out_shape to avoid reading excessive pixels
            target_pixels = MAX_PREVIEW_PIXELS
            height, width = src.height, src.width
            scale = max(1.0, (height * width) / target_pixels)
            if scale > 1.0:
                # compute downsampled size preserving aspect ratio
                out_height = max(1, int(height / (scale ** 0.5)))
                out_width = max(1, int(width / (scale ** 0.5)))
                logging.info(f"Thumbnail - Downsampling from {width}x{height} to {out_width}x{out_height} to limit pixels ~{out_height*out_width}")
                data = src.read(out_shape=(src.count, out_height, out_width))
            else:
                data = src.read()
            logging.info(f"Read data shape: {data.shape} (bands, height, width)")
            
            # Handle different numbers of bands
            if data.shape[0] == 1:
                # Single band (DEM) - use colormap
                band_data = data[0]
                # Normalize to 0-255 for better visualization
                valid_data = band_data[~np.isnan(band_data)]
                if len(valid_data) > 0:
                    vmin, vmax = np.percentile(valid_data, [2, 98])
                    normalized = np.clip((band_data - vmin) / (vmax - vmin), 0, 1)
                else:
                    normalized = band_data
                
                # Create figure
                fig, ax = plt.subplots(figsize=(8, 8))
                im = ax.imshow(normalized, cmap='terrain', aspect='equal')
                ax.set_title(f'DEM Preview')
                ax.axis('off')
                
            elif data.shape[0] >= 3:
                # Multi-band (RGB orthomosaic)
                logging.info(f"Processing orthomosaic with {data.shape[0]} bands, shape: {data.shape}")
                logging.info(f"Original TIF size: {src.width}x{src.height}, Read data size: {data.shape[2]}x{data.shape[1]}")
                
                # Handle no-data values
                if hasattr(src, 'nodata') and src.nodata is not None:
                    data = np.where(data == src.nodata, np.nan, data)
                    logging.debug(f"Applied nodata mask for value: {src.nodata}")
                
                # Take first 3 bands as RGB (usually bands 1,2,3)
                rgb = data[:3].astype(np.float32)
                logging.info(f"RGB array shape after extraction: {rgb.shape}")
                
                # Check for valid data
                valid_pixels = ~np.isnan(rgb).all(axis=0)
                if not valid_pixels.any():
                    logging.warning("No valid pixels found in orthomosaic")
                    return False
                
                # Transpose to (height, width, channels)
                rgb = np.transpose(rgb, (1, 2, 0))
                
                # More robust normalization for each band
                for i in range(3):
                    band = rgb[:, :, i]
                    valid_data = band[~np.isnan(band)]
                    
                    if len(valid_data) > 0:
                        # Use more conservative percentiles and handle different data ranges
                        vmin, vmax = np.percentile(valid_data, [1, 99])
                        
                        # Handle case where min == max
                        if vmax == vmin:
                            vmax = vmin + 1
                        
                        # Check if data might be 16-bit (values > 255)
                        if vmax > 255:
                            # Likely 16-bit data, normalize differently
                            vmin, vmax = np.percentile(valid_data, [5, 95])
                        
                        # Normalize to 0-1
                        band_norm = np.clip((band - vmin) / (vmax - vmin), 0, 1)
                        rgb[:, :, i] = band_norm
                        
                        logging.debug(f"Band {i}: min={vmin:.2f}, max={vmax:.2f}, valid_pixels={len(valid_data)}")
                    else:
                        rgb[:, :, i] = 0
                
                # Create figure
                fig, ax = plt.subplots(figsize=(8, 8))
                ax.imshow(rgb, aspect='equal')
                ax.set_title('Orthomosaic Preview')
                ax.axis('off')
                logging.info(f"Thumbnail - Displaying RGB image with shape: {rgb.shape}")
                logging.info(f"Created matplotlib figure with RGB shape: {rgb.shape}")
            
            else:
                logging.warning(f"Unsupported number of bands: {data.shape[0]}")
                return False
            
            # Save as PNG
            plt.tight_layout()
            plt.savefig(output_path, dpi=100, bbox_inches='tight', pad_inches=0)
            plt.close()
            logging.info(f"Saved initial PNG to: {output_path}")
            
            # Resize to max_size if needed
            with Image.open(output_path) as img:
                original_size = img.size
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                final_size = img.size
                img.save(output_path, 'PNG', optimize=True)
                logging.info(f"Resized thumbnail from {original_size} to {final_size}, target max: {max_size}")
            
            logging.info(f"Created thumbnail: {output_path}")
            return True
            
    except Exception as e:
        logging.error(f"Failed to create thumbnail for {tif_path}: {e}")
        return False

def create_large_preview(tif_path: str, output_path: str, max_size: Tuple[int, int] = (1200, 1200)) -> bool:
    """Create larger PNG preview from TIF file."""
    if not HAS_RASTERIO:
        logging.warning("Rasterio not available, skipping large preview generation")
        return False
        
    try:
        with rasterio.open(tif_path) as src:
            # Read the data with subsampling for large files
            height, width = src.height, src.width
            logging.info(f"Large preview - Original TIF dimensions: {width}x{height}, bands: {src.count}")

            # First cap by requested max_size to preserve visual size
            scale_factor = max(height / max_size[1], width / max_size[0])
            # Also consider absolute pixel cap
            total_pixels = height * width
            if total_pixels > MAX_PREVIEW_PIXELS:
                pixel_scale = (total_pixels / MAX_PREVIEW_PIXELS) ** 0.5
            else:
                pixel_scale = 1.0

            effective_scale = max(1.0, scale_factor, pixel_scale)
            logging.info(f"Large preview - Effective scale: {effective_scale:.2f}, target max: {max_size}, pixel cap: {MAX_PREVIEW_PIXELS}")

            if effective_scale > 1.0:
                out_height = max(1, int(height / effective_scale))
                out_width = max(1, int(width / effective_scale))
                logging.info(f"Large preview - Reading downsampled size: {out_width}x{out_height} (bands: {src.count})")
                data = src.read(out_shape=(src.count, out_height, out_width))
                logging.info(f"Large preview - Subsampled data shape: {data.shape}")
            else:
                logging.info(f"Large preview - Reading full resolution")
                data = src.read()
                logging.info(f"Large preview - Full resolution data shape: {data.shape}")
            
            # Handle different numbers of bands (same logic as thumbnail)
            if data.shape[0] == 1:
                # Single band (DEM) 
                band_data = data[0]
                valid_data = band_data[~np.isnan(band_data)]
                if len(valid_data) > 0:
                    vmin, vmax = np.percentile(valid_data, [2, 98])
                    normalized = np.clip((band_data - vmin) / (vmax - vmin), 0, 1)
                else:
                    normalized = band_data
                
                fig, ax = plt.subplots(figsize=(12, 12))
                im = ax.imshow(normalized, cmap='terrain', aspect='equal')
                ax.set_title(f'DEM Large Preview')
                ax.axis('off')
                
            elif data.shape[0] >= 3:
                # Multi-band (RGB orthomosaic) - same logic as thumbnail
                logging.info(f"Large preview - Processing orthomosaic with {data.shape[0]} bands, shape: {data.shape}")
                
                # Handle no-data values
                if hasattr(src, 'nodata') and src.nodata is not None:
                    data = np.where(data == src.nodata, np.nan, data)
                    logging.debug(f"Large preview - Applied nodata mask for value: {src.nodata}")
                
                # Take first 3 bands as RGB
                rgb = data[:3].astype(np.float32)
                logging.info(f"Large preview - RGB array shape after extraction: {rgb.shape}")
                
                # Check for valid data
                valid_pixels = ~np.isnan(rgb).all(axis=0)
                if not valid_pixels.any():
                    logging.warning("No valid pixels found in large preview orthomosaic")
                    return False
                
                # Transpose to (height, width, channels)
                rgb = np.transpose(rgb, (1, 2, 0))
                
                # Same robust normalization
                for i in range(3):
                    band = rgb[:, :, i]
                    valid_data = band[~np.isnan(band)]
                    
                    if len(valid_data) > 0:
                        vmin, vmax = np.percentile(valid_data, [1, 99])
                        
                        if vmax == vmin:
                            vmax = vmin + 1
                        
                        if vmax > 255:
                            vmin, vmax = np.percentile(valid_data, [5, 95])
                        
                        band_norm = np.clip((band - vmin) / (vmax - vmin), 0, 1)
                        rgb[:, :, i] = band_norm
                    else:
                        rgb[:, :, i] = 0
                
                fig, ax = plt.subplots(figsize=(12, 12))
                ax.imshow(rgb, aspect='equal')
                ax.set_title('Orthomosaic Large Preview')
                ax.axis('off')
                logging.info(f"Large preview - Created matplotlib figure with RGB shape: {rgb.shape}")
            
            else:
                return False
            
            # Save as PNG
            plt.tight_layout()
            plt.savefig(output_path, dpi=150, bbox_inches='tight', pad_inches=0)
            plt.close()
            logging.info(f"Large preview - Saved initial PNG to: {output_path}")
            
            # Resize to max_size if needed (should already be close)
            with Image.open(output_path) as img:
                original_size = img.size
                if img.size[0] > max_size[0] or img.size[1] > max_size[1]:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)
                    img.save(output_path, 'PNG', optimize=True)
                    final_size = img.size
                    logging.info(f"Large preview - Resized from {original_size} to {final_size}, target max: {max_size}")
                else:
                    logging.info(f"Large preview - No resize needed, size: {original_size}, target max: {max_size}")
            
            logging.info(f"Created large preview: {output_path}")
            return True
            
    except Exception as e:
        logging.error(f"Failed to create large preview for {tif_path}: {e}")
        return False

def detect_product_type(filename: str) -> Optional[str]:
    """Detect product type from filename patterns."""    
    for product_type, patterns in PRODUCT_PATTERNS.items():
        for pattern in patterns:
            if re.match(pattern, filename, re.IGNORECASE):
                return product_type
    return None

def extract_metadata_from_filename(filename: str, region_config: dict) -> dict:
    """Extract metadata from filename."""
    # Extract year from filename - handles multiple formats
    year_match = re.search(r'^(\d{4})', filename)
    if year_match:
        year = year_match.group(1)
    else:
        year_match = re.search(r'(\d{4})', filename)
        year = year_match.group(1) if year_match else "unknown"
    
    # Extract site code (OCC-XXX-### pattern)
    site_match = re.search(r'OCC-([A-Z]{3})-(\d+)', filename.upper())
    if site_match:
        island_code = site_match.group(1)
        site_number = site_match.group(2)
        site_code = f"OCC-{island_code}-{site_number}"
    else:
        island_code = "UNK"
        site_code = filename.split('.')[0]
    
    # Extract survey code (like RA2201)
    survey_match = re.search(r'_([A-Z]{2}\d{4})_', filename.upper())
    survey_code = survey_match.group(1) if survey_match else None
    
    return {
        'year': year,
        'island_code': island_code,
        'site_code': site_code,
        'survey_code': survey_code,
        'region_code': region_config['code'],
        'filename': filename
    }

def list_files_with_gsutil(gcs_prefix: str) -> List[dict]:
    """Use gsutil ls -l to get file listing with sizes."""
    try:
        # Run gsutil ls -l to get detailed listing
        cmd = f'gsutil ls -l {gcs_prefix}/*.tif'
        logging.debug(f"Running command: {cmd}")
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, check=True)
        
        logging.debug(f"gsutil stdout length: {len(result.stdout)}")
        logging.debug(f"gsutil stderr: {result.stderr}")
        if result.stdout:
            logging.debug(f"First few lines of output: {result.stdout[:200]}")
        
        files = []
        lines = result.stdout.strip().split('\n')
        logging.debug(f"Processing {len(lines)} lines of output")
        
        for i, line in enumerate(lines):
            if not line or 'TOTAL:' in line or line.strip() == "":
                continue
                
            logging.debug(f"Processing line {i}: {line}")
            
            # Parse gsutil ls -l output: "size datetime gs://path"
            parts = line.strip().split()
            if len(parts) >= 3 and parts[-1].startswith('gs://'):
                try:
                    size_bytes = int(parts[0]) if parts[0].isdigit() else 0
                    gcs_path = parts[-1]
                    filename = gcs_path.split('/')[-1]
                    
                    files.append({
                        'gcs_path': gcs_path,
                        'filename': filename,
                        'size_bytes': size_bytes
                    })
                    logging.debug(f"Found file: {filename} ({size_bytes} bytes)")
                except (ValueError, IndexError) as e:
                    logging.debug(f"Could not parse line: {line} - {e}")
                    continue
            else:
                logging.debug(f"Skipping line (not enough parts or wrong format): {line}")
                
        return files
        
    except subprocess.CalledProcessError as e:
        logging.error(f"gsutil command failed: {e}")
        logging.error(f"stderr: {e.stderr}")
        return []
    except Exception as e:
        logging.error(f"Error listing files: {e}")
        return []

def process_all_regions(out_dir: Path, create_thumbnails: bool = True, test_mode: bool = False) -> dict:
    """Process optical products for all regions."""
    
    logging.info("Processing all regions for optical products using gsutil")
    # Per-run temp directory to hold downloads/previews for this processing run
    run_temp_dir = Path(tempfile.mkdtemp(prefix='optics-build-'))
    logging.info(f"Created run temp directory: {run_temp_dir}")
    
    # Create output directories
    out_dir.mkdir(parents=True, exist_ok=True)
    items_dir = out_dir / "items"
    items_dir.mkdir(exist_ok=True)
    
    if create_thumbnails and HAS_RASTERIO:
        thumbs_dir = out_dir / "thumbnails"
        thumbs_dir.mkdir(exist_ok=True)
        previews_dir = out_dir / "previews"  
        previews_dir.mkdir(exist_ok=True)
        logging.info("Will generate thumbnails and large previews")
    elif create_thumbnails:
        logging.warning("Thumbnail generation requested but rasterio not available")
        create_thumbnails = False
    
    all_cards = []
    total_size = 0
    type_counts = Counter()
    year_counts = Counter()
    island_counts = Counter()
    region_counts = Counter()
    
    # Process each region
    for region_key, region_config in REGION_CONFIGS.items():
        logging.info(f"Processing region: {region_config['name']}")
        
        # List files using gsutil
        files = list_files_with_gsutil(region_config['gcs_prefix'])
        logging.info(f"Found {len(files)} TIF files in {region_config['name']}")
        
        if not files:
            logging.warning(f"No TIF files found in {region_config['name']}")
            continue
        
        # Limit files for test mode
        if test_mode:
            files = files[:2]
            logging.info(f"Test mode: limiting to first {len(files)} files")
        
        # Process each file
        for i, file_info in enumerate(files, 1):
            try:
                filename = file_info['filename']
                
                # Detect product type
                product_type = detect_product_type(filename)
                if product_type is None:
                    logging.debug(f"Unknown product type for: {filename}")
                    continue
                
                # Extract metadata
                metadata = extract_metadata_from_filename(filename, region_config)
                
                # Create unique ID
                product_id = safe_id(f"{region_key}-{metadata['site_code']}-{metadata['year']}-{product_type}")
                
                # Update counters
                total_size += file_info['size_bytes']
                type_counts[product_type] += 1
                year_counts[metadata['year']] += 1
                island_counts[metadata['island_code']] += 1
                region_counts[region_config['code']] += 1
                
                # Create card
                card = {
                    'id': product_id,
                    'title': f"{metadata['site_code']} {product_type.upper()} ({metadata['year']})",
                    'region': region_config['name'],
                    'region_code': region_config['code'],
                    'island_code': metadata['island_code'],
                    'site_code': metadata['site_code'],
                    'year': metadata['year'],
                    'product_type': product_type,
                    'filename': filename,
                    'gcs_uri': file_info['gcs_path'],
                    'https_url': gs_to_https(file_info['gcs_path']),
                    'size_bytes': file_info['size_bytes'],
                    'size_human': human_bytes(file_info['size_bytes']),
                    'category': 'optical-products',
                    'tags': [metadata['year'], region_config['code'], metadata['island_code'], metadata['site_code'], product_type]
                }
                
                # Add survey code if available
                if metadata['survey_code']:
                    card['survey_code'] = metadata['survey_code']
                    card['tags'].append(metadata['survey_code'])
                
                # Generate thumbnails and previews if requested
                if create_thumbnails:
                    thumbnail_path = thumbs_dir / f"{product_id}.png"
                    preview_path = previews_dir / f"{product_id}_large.jpg"
                    
                    # Create temporary file path inside the run temp dir for downloading
                    temp_path = str(run_temp_dir / f"{product_id}.tif")
                    # Ensure any existing file is removed
                    if os.path.exists(temp_path):
                        try:
                            os.unlink(temp_path)
                        except Exception:
                            pass
                    
                    try:
                        logging.info(f"Processing thumbnails for {filename} ({i}/{len(files)})...")
                        
                        # Download TIF file temporarily
                        if download_gcs_file(file_info['gcs_path'], temp_path):
                            # Diagnose TIF file and save metadata
                            tif_info = diagnose_tif(temp_path)
                            if 'error' not in tif_info:
                                card['tif_info'] = tif_info
                                logging.debug(f"TIF info for {filename}: {tif_info}")
                            else:
                                logging.warning(f"Could not diagnose {filename}: {tif_info['error']}")
                            
                            # Create thumbnail (512x512)
                            if create_thumbnail(temp_path, str(thumbnail_path)):
                                card['thumbnail'] = f"thumbnails/{product_id}.png"
                                logging.debug(f"Created thumbnail for {filename}")
                            
                            # Create large preview (1200x1200, saved as JPG for smaller size)
                            temp_preview = str(preview_path).replace('.jpg', '_temp.png')
                            if create_large_preview(temp_path, temp_preview):
                                # Convert PNG to JPG for smaller file size
                                try:
                                    with Image.open(temp_preview) as img:
                                        # Convert to RGB if necessary (removes alpha channel)
                                        if img.mode != 'RGB':
                                            img = img.convert('RGB')
                                        img.save(str(preview_path), 'JPEG', quality=85, optimize=True)
                                        os.unlink(temp_preview)  # Remove temp PNG
                                        card['large_preview'] = f"previews/{product_id}_large.jpg"
                                        logging.debug(f"Created large preview for {filename}")
                                except Exception as e:
                                    logging.error(f"Failed to convert preview to JPG: {e}")
                                    if os.path.exists(temp_preview):
                                        os.unlink(temp_preview)
                        else:
                            logging.warning(f"Failed to download {filename} for thumbnail generation")
                        
                    except Exception as e:
                        logging.error(f"Error processing thumbnails for {filename}: {e}")
                    finally:
                        # Always clean up temporary TIF file
                        if os.path.exists(temp_path):
                            os.unlink(temp_path)
                            logging.debug(f"Cleaned up temporary file: {temp_path}")
                
                all_cards.append(card)
                
                # Save individual product details
                detail = {
                    'id': product_id,
                    'title': card['title'],
                    'metadata': metadata,
                    'product_info': {
                        'type': product_type,
                        'filename': filename,
                        'gcs_uri': file_info['gcs_path'],
                        'https_url': card['https_url'],
                        'size_bytes': file_info['size_bytes'],
                        'size_human': card['size_human']
                    },
                    'geographic_info': {
                        'region': region_config['name'],
                        'region_code': region_config['code'],
                        'island_code': metadata['island_code'],
                        'site_code': metadata['site_code']
                    }
                }
                
                # Add TIF technical metadata if available
                if 'tif_info' in card:
                    detail['tif_info'] = card['tif_info']
                
                # Add thumbnail/preview paths if available
                if 'thumbnail' in card:
                    detail['thumbnail'] = card['thumbnail']
                if 'large_preview' in card:
                    detail['large_preview'] = card['large_preview']
                
                # Write individual detail JSON
                detail_file = items_dir / f"{product_id}.json"
                detail_file.write_text(json.dumps(detail, indent=2))
                
                logging.debug(f"Processed: {filename} -> {product_type}")
                    
            except Exception as e:
                logging.error(f"Failed to process file {file_info['gcs_path']}: {e}")
                continue
        
        logging.info(f"Processed {len([c for c in all_cards if c['region_code'] == region_config['code']])} products from {region_config['name']}")
    
    # Create combined summary
    all_islands = []
    for region_config in REGION_CONFIGS.values():
        all_islands.extend(region_config['islands'])
    
    summary = {
        'build_info': {
            'regions_processed': list(REGION_CONFIGS.keys()),
            'gcs_prefixes': [config['gcs_prefix'] for config in REGION_CONFIGS.values()],
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'products_processed': len(all_cards),
            'method': 'gsutil'
        },
        'totals': {
            'products': len(all_cards),
            'size_bytes': total_size,
            'size_human': human_bytes(total_size)
        },
        'by_type': dict(type_counts),
        'by_year': dict(sorted(year_counts.items())),
        'by_island': dict(island_counts),
        'by_region': dict(region_counts),
        'regions': {key: config['name'] for key, config in REGION_CONFIGS.items()},
        'islands': list(set(all_islands))
    }
    
    # Clean up run temp directory if it exists
    try:
        import shutil
        if run_temp_dir and run_temp_dir.exists():
            shutil.rmtree(run_temp_dir)
            logging.info(f"Removed run temp directory: {run_temp_dir}")
    except Exception as e:
        logging.warning(f"Failed to remove run temp directory {run_temp_dir}: {e}")

    return {
        'cards': all_cards,
        'summary': summary
    }

def main():
    parser = argparse.ArgumentParser(description='Build combined index for optical products using gsutil')
    parser.add_argument('--out-dir', required=True, type=Path,
                      help='Output directory for generated files')
    parser.add_argument('--no-thumbnails', action='store_true',
                      help='Skip thumbnail and preview generation')
    parser.add_argument('--test-mode', action='store_true',
                      help='Process only first 2 files from each region for testing')
    parser.add_argument('--log-level', default='INFO',
                      help='Logging level (DEBUG, INFO, WARNING, ERROR)')
    
    args = parser.parse_args()
    
    setup_logger(args.log_level)

    start_time = time.time()
    
    try:
        # Process all regions
        result = process_all_regions(
            out_dir=args.out_dir,
            create_thumbnails=not args.no_thumbnails,
            test_mode=args.test_mode
        )
        
        if result:
            # Write index.json
            index_file = args.out_dir / "index.json"
            index_file.write_text(json.dumps(result['cards'], indent=2))
            logging.info(f"Wrote index: {index_file}")
            
            # Write summary.json
            summary_file = args.out_dir / "summary.json"
            summary_file.write_text(json.dumps(result['summary'], indent=2))
            logging.info(f"Wrote summary: {summary_file}")
            
            duration = time.time() - start_time
            logging.info(f"Completed in {duration:.1f}s")
            logging.info(f"Generated {len(result['cards'])} product records from all regions")
            
            # Print summary
            print("\n" + "="*60)
            print("OPTICAL PRODUCTS SUMMARY")
            print("="*60)
            for region_code, count in result['summary']['by_region'].items():
                region_name = [config['name'] for config in REGION_CONFIGS.values() if config['code'] == region_code][0]
                print(f"{region_name}: {count} products")
            
            print(f"\nTotal: {result['summary']['totals']['products']} products")
            print(f"Total size: {result['summary']['totals']['size_human']}")
            print(f"\nDEMs: {result['summary']['by_type'].get('dem', 0)}")
            print(f"Orthomosaics: {result['summary']['by_type'].get('ortho', 0)}")
            
            # Show thumbnail/preview stats
            if not args.no_thumbnails:
                thumbnail_count = len([c for c in result['cards'] if 'thumbnail' in c])
                preview_count = len([c for c in result['cards'] if 'large_preview' in c])
                print(f"Thumbnails generated: {thumbnail_count}")
                print(f"Large previews generated: {preview_count}")
        
    except Exception as e:
        logging.error(f"Failed to process optical products: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()