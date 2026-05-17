# level1_calibration.py
# This file is now redundant as Level 1 Calibration logic has been replaced
# by the Interactive Calibration approach in instrument_processor.py.
# The functions are minimized to avoid import errors in older code.

def _is_separator_line(text):
    return False

def _validate_and_format_tag(ocr_results_for_roi, ocr_validation_config, text_concat_separator):
    return (None, "Deprecated")

def calibrate_radius_range(pil_image, blurred_image, vision_client, legend_types, config_params, debug_params, font, status_update_fn=None):
    """
    DEPRECATED: Now replaced by interactive calibration. This function only returns
    default broad radii to prevent immediate downstream errors if called.
    """
    if status_update_fn:
        status_update_fn("L1: DEPRECATED - Using default broad radius range.")
    return config_params['HOUGH_MIN_RADIUS'], config_params['HOUGH_MAX_RADIUS']