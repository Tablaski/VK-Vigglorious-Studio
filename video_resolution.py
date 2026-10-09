import json
import math


RATIOS = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4}
BUDGETS = {"test": 400000, "standard": 600000, "detail": 1200000}


def resolution_plan(width, height, config):
    settings = json.loads(config)
    if not isinstance(settings, dict):
        raise ValueError("Resolution settings must be a JSON object.")
    profile = settings.get("profile", "original")
    ratio_name = settings.get("format", "source")
    fit = settings.get("fit", "crop")
    if profile not in {"original", "viggle", "h3", "custom"} or fit not in {"crop", "pad"}:
        raise ValueError("Choose an available resolution profile and Crop or Pad.")
    if ratio_name != "source" and ratio_name not in RATIOS:
        raise ValueError("Choose an available video format.")
    ratio = width / height if ratio_name == "source" else RATIOS[ratio_name]
    budget = settings.get("budget", "standard")
    if budget not in {*BUDGETS, "custom"}:
        raise ValueError("Choose Test, Standard, Detail or Custom MP.")
    multiple = int(settings.get("multiple", 32))
    if not 1 <= multiple <= 16384:
        raise ValueError("Pixel multiple must be between 1 and 16384.")
    if profile == "original":
        target_width, target_height = width, height
    elif profile == "custom":
        target_width, target_height = int(settings.get("width", width)), int(settings.get("height", height))
        if not 1 <= target_width <= 16384 or not 1 <= target_height <= 16384:
            raise ValueError("Custom dimensions must be between 1 and 16384 pixels.")
    elif profile == "h3":
        target_width, target_height = (768 * ratio, 768) if ratio >= 1 else (768, 768 / ratio)
    else:
        pixels = float(settings.get("megapixels", 0.6)) * 1000000 if budget == "custom" else BUDGETS[budget]
        if not math.isfinite(pixels) or pixels <= 0:
            raise ValueError("Enter a positive megapixel budget.")
        target_width = math.sqrt(pixels * ratio)
        target_height = target_width / ratio
    if profile != "original":
        target_width = max(multiple, math.floor(target_width / multiple + 0.5) * multiple)
        target_height = max(multiple, math.floor(target_height / multiple + 0.5) * multiple)
    target_ratio = target_width / target_height
    filters = []
    rect = [0, 0, width, height]
    if profile != "original":
        if fit == "crop":
            crop_width = min(width, max(1, math.floor(height * target_ratio)))
            crop_height = min(height, max(1, math.floor(width / target_ratio)))
            x = float(settings.get("x", 0.5))
            y = float(settings.get("y", 0.5))
            if not math.isfinite(x) or not math.isfinite(y):
                raise ValueError("Crop position must be finite.")
            left = math.floor(max(0, min(1, x)) * (width - crop_width) + 0.5)
            top = math.floor(max(0, min(1, y)) * (height - crop_height) + 0.5)
            rect = [left, top, crop_width, crop_height]
            if rect != [0, 0, width, height]:
                filters.append(f"crop={crop_width}:{crop_height}:{left}:{top}:exact=1")
            filters.append(f"scale={target_width}:{target_height}")
        else:
            scale = min(target_width / width, target_height / height)
            scaled_width = min(target_width, max(1, math.floor(width * scale + 0.5)))
            scaled_height = min(target_height, max(1, math.floor(height * scale + 0.5)))
            filters.extend([f"scale={scaled_width}:{scaled_height}",
                            f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black"])
        filters.append("setsar=1")
    return {"width": target_width, "height": target_height, "rect": rect, "filters": filters,
            "profile": profile, "format": ratio_name, "fit": fit}
