from __future__ import annotations

import asyncio
from collections import OrderedDict
from io import BytesIO
import json
import math
import os
from pathlib import Path
import threading
import time
import uuid

from aiohttp import web
from PIL import Image, ImageOps

import comfy.utils
import folder_paths
from nodes import LoadImage
from server import PromptServer


IMAGE_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
NO_RESIZE = "none"
RESIZE_BY_LARGEST_SIDE = "resize by largest side"
SCALE_TO_MEGAPIXELS = "scale to megapixels"
GALLERY_PAGE_SIZE = 24
_GALLERY_TTL = 60.0
_THUMBNAIL_SIZE = (192, 192)
_THUMBNAIL_CACHE_LIMIT = 128
_STATE_LOCK = threading.RLock()
_GALLERY_CACHE = {"created": 0.0, "items": []}
_THUMBNAIL_CACHE = OrderedDict()
_USAGE = None


def _aspect_ratio(width: int, height: int) -> str:
    divisor = math.gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _resize_dimensions(width: int, height: int, resize_mode: str, longest_side: int, megapixels: float, upscale: bool = True) -> tuple[int, int]:
    if resize_mode == NO_RESIZE:
        return width, height
    if resize_mode == RESIZE_BY_LARGEST_SIDE:
        scale = longest_side / max(width, height)
    elif resize_mode == SCALE_TO_MEGAPIXELS:
        scale = math.sqrt(megapixels * 1_000_000 / (width * height))
    else:
        raise ValueError(f"Unknown resize mode: {resize_mode}")
    if not upscale:
        scale = min(scale, 1.0)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _usage_path() -> Path:
    return Path(folder_paths.get_user_directory()) / "vk_nodes" / "viggle_load_image_usage.json"


def _load_usage() -> dict[str, float]:
    global _USAGE
    with _STATE_LOCK:
        if _USAGE is not None:
            return dict(_USAGE)
        try:
            data = json.loads(_usage_path().read_text(encoding="utf-8"))
            _USAGE = {str(name): float(value) for name, value in data.items()}
        except (FileNotFoundError, OSError, ValueError, TypeError):
            _USAGE = {}
        return dict(_USAGE)


def _mark_used(name: str) -> None:
    global _USAGE
    with _STATE_LOCK:
        usage = _load_usage()
        usage[name] = time.time()
        _USAGE = usage
        _GALLERY_CACHE["created"] = 0.0
        try:
            target = _usage_path()
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(".tmp")
            temporary.write_text(json.dumps(usage, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, target)
        except OSError:
            pass


def _input_path(name: str) -> Path:
    if not isinstance(name, str) or not name or "\x00" in name:
        raise ValueError("Invalid input image.")
    root = Path(folder_paths.get_input_directory()).resolve()
    path = (root / Path(name.replace("/", os.sep))).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ValueError("The image must be inside the ComfyUI input folder.") from error
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError("Input image not found.")
    return path


def _scan_gallery(force: bool = False) -> list[dict]:
    now = time.monotonic()
    with _STATE_LOCK:
        if not force and now - _GALLERY_CACHE["created"] < _GALLERY_TTL:
            return list(_GALLERY_CACHE["items"])

    root = Path(folder_paths.get_input_directory()).resolve()
    usage = _load_usage()
    items = []
    for folder, _directories, filenames in os.walk(root):
        for filename in filenames:
            path = Path(folder) / filename
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            try:
                resolved = path.resolve()
                resolved.relative_to(root)
                modified = resolved.stat().st_mtime
            except (OSError, ValueError):
                continue
            name = resolved.relative_to(root).as_posix()
            items.append({"name": name, "used_at": usage.get(name, modified), "mtime": modified})

    items.sort(key=lambda item: (-item["used_at"], item["name"].casefold()))
    with _STATE_LOCK:
        _GALLERY_CACHE["created"] = now
        _GALLERY_CACHE["items"] = items
    return list(items)


def _thumbnail(name: str, mtime: float) -> bytes:
    key = (name, mtime)
    with _STATE_LOCK:
        cached = _THUMBNAIL_CACHE.get(key)
        if cached is not None:
            _THUMBNAIL_CACHE.move_to_end(key)
            return cached

    path = _input_path(name)
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail(_THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=82, optimize=True)
        data = output.getvalue()

    with _STATE_LOCK:
        _THUMBNAIL_CACHE[key] = data
        _THUMBNAIL_CACHE.move_to_end(key)
        while len(_THUMBNAIL_CACHE) > _THUMBNAIL_CACHE_LIMIT:
            _THUMBNAIL_CACHE.popitem(last=False)
    return data


def _neighbors(name: str) -> tuple[str | None, str | None]:
    items = _scan_gallery()
    index = next((index for index, item in enumerate(items) if item["name"] == name), None)
    if index is None:
        items = _scan_gallery(True)
        index = next((index for index, item in enumerate(items) if item["name"] == name), None)
    if index is None:
        return None, None
    previous = items[index - 1]["name"] if index > 0 else None
    following = items[index + 1]["name"] if index + 1 < len(items) else None
    return previous, following


@PromptServer.instance.routes.get("/vk-nodes/viggle-load-image/gallery")
async def viggle_load_image_gallery(request):
    try:
        offset = max(0, int(request.query.get("offset", 0)))
        limit = min(GALLERY_PAGE_SIZE, max(1, int(request.query.get("limit", GALLERY_PAGE_SIZE))))
    except ValueError:
        return web.json_response({"error": "Invalid pagination."}, status=400)
    items = await asyncio.to_thread(_scan_gallery)
    page = items[offset:offset + limit]
    return web.json_response({"items": page, "offset": offset, "total": len(items), "has_more": offset + len(page) < len(items)})


@PromptServer.instance.routes.get("/vk-nodes/viggle-load-image/neighbors")
async def viggle_load_image_neighbors(request):
    name = request.query.get("image", "")
    previous, following = await asyncio.to_thread(_neighbors, name)
    return web.json_response({"previous": previous, "next": following})


@PromptServer.instance.routes.get("/vk-nodes/viggle-load-image/thumbnail")
async def viggle_load_image_thumbnail(request):
    name = request.query.get("image", "")
    try:
        path = _input_path(name)
        data = await asyncio.to_thread(_thumbnail, name, path.stat().st_mtime)
    except (ValueError, FileNotFoundError, OSError):
        raise web.HTTPNotFound()
    return web.Response(body=data, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


class VKViggleLoadImage(LoadImage):
    DESCRIPTION = "Load an image with a recent-input gallery and chronological navigation."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("STRING", {"default": "", "multiline": False, "tooltip": "Input image path selected with the gallery, upload, drag and drop, or paste."}),
                "resize_mode": ([RESIZE_BY_LARGEST_SIDE, SCALE_TO_MEGAPIXELS, NO_RESIZE], {"default": RESIZE_BY_LARGEST_SIDE, "tooltip": "Resize by longest side or megapixel count; none preserves the original dimensions."}),
                "longest_side": ("INT", {"default": 1920, "min": 1, "max": 32768, "step": 1, "tooltip": "Target longest side in pixels when resizing by largest side. Start with 1920."}),
                "megapixels": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 1000.0, "step": 0.01, "tooltip": "Target pixel count in millions when scaling to megapixels. Start with 1.0."}),
                "upscale": ("BOOLEAN", {"default": True, "tooltip": "Allow resize to enlarge the image. Disable to only reduce its size."}),
            }
        }

    CATEGORY = "VK/Viggle"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "aspect_ratio", "height", "width")
    OUTPUT_TOOLTIPS = ("Loaded image after the selected resize.", "Alpha-derived mask resized with the image.", "Reduced width:height ratio after resizing.", "Output height in pixels.", "Output width in pixels.")

    @classmethod
    def IS_CHANGED(cls, image, resize_mode=RESIZE_BY_LARGEST_SIDE, longest_side=1920, megapixels=1.0, upscale=True):
        return super().IS_CHANGED(image), resize_mode, longest_side, megapixels, upscale

    @classmethod
    def VALIDATE_INPUTS(cls, image, resize_mode=RESIZE_BY_LARGEST_SIDE, longest_side=1920, megapixels=1.0, upscale=True):
        return super().VALIDATE_INPUTS(image)

    def load_image(self, image, resize_mode=RESIZE_BY_LARGEST_SIDE, longest_side=1920, megapixels=1.0, upscale=True):
        output, mask = super().load_image(image)
        height, width = output.shape[1:3]
        width, height = _resize_dimensions(width, height, resize_mode, longest_side, megapixels, upscale)
        if output.shape[2] != width or output.shape[1] != height:
            output = comfy.utils.common_upscale(output.movedim(-1, 1), width, height, "lanczos", "disabled").movedim(1, -1)
            mask = comfy.utils.common_upscale(mask.unsqueeze(1), width, height, "lanczos", "disabled").squeeze(1)
        _mark_used(image)
        return output, mask, _aspect_ratio(width, height), height, width


DEFAULT_ANGLES = '[{"id":"front","name":"front","image":""},{"id":"side","name":"side","image":""}]'


def parse_angles(value):
    angles = json.loads(value)
    if not isinstance(angles, list):
        raise ValueError("Viggle: reference angles must be a list.")
    ids = set()
    for angle in angles:
        if not isinstance(angle, dict) or any(not isinstance(angle.get(key), str) for key in ("id", "name", "image")):
            raise ValueError("Viggle: each angle needs an id, name and image path.")
        if not angle["id"] or angle["id"] in ids or not angle["name"].strip():
            raise ValueError("Viggle: angle ids must be unique and names cannot be empty.")
        ids.add(angle["id"])
    return angles


def parse_characters(value):
    characters = json.loads(value)
    if not isinstance(characters, list):
        raise ValueError("Viggle: characters must be a list.")
    ids, angle_ids = set(), {"head": set(), "body": set()}
    for character in characters:
        if not isinstance(character, dict) or not isinstance(character.get("name"), str) or not character["name"].strip():
            raise ValueError("Viggle: each character needs a label.")
        identifier = character.get("id")
        if not isinstance(identifier, str) or str(uuid.UUID(identifier)) != identifier or identifier in ids:
            raise ValueError("Viggle: character ids must be unique UUIDs.")
        ids.add(identifier)
        for role in ("head", "body"):
            for angle in parse_angles(json.dumps(character[role])):
                if angle["id"] in angle_ids[role]:
                    raise ValueError("Viggle: angle ids must be unique across characters.")
                angle_ids[role].add(angle["id"])
    return characters


def _characters_path():
    return Path(folder_paths.get_user_directory()) / "vk_nodes" / "viggle_characters.json"


def _read_characters():
    try:
        return parse_characters(_characters_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def _save_character(character, delete=False):
    parse_characters(json.dumps([character]))
    with _STATE_LOCK:
        characters = [item for item in _read_characters() if item["id"] != character["id"]]
        if not delete:
            for role in ("head", "body"):
                for angle in character[role]:
                    if angle["image"]:
                        _input_path(angle["image"])
            characters.append(character)
        parse_characters(json.dumps(characters))
        target = _characters_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(characters, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, target)
    return characters


@PromptServer.instance.routes.get("/vk-nodes/viggle-characters")
async def viggle_characters(request):
    try:
        return web.json_response({"characters": await asyncio.to_thread(_read_characters)})
    except (OSError, ValueError, KeyError, TypeError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.post("/vk-nodes/viggle-characters")
async def viggle_save_character(request):
    try:
        payload = await request.json()
        characters = await asyncio.to_thread(_save_character, payload["character"], payload.get("delete") is True)
        return web.json_response({"characters": characters})
    except (OSError, ValueError, KeyError, TypeError) as error:
        return web.json_response({"error": str(error)}, status=400)


class VKViggleLoadMultipleImages:
    DESCRIPTION = "Select, clone or save a character with head and optional full-body reference angles. Connect reference_angles and body_reference_angles to Video Manager. New guides use the selected character; existing guides keep their angle assignments. Head and Full body have independent global resize settings, outside saved characters."
    CATEGORY = "VK/Viggle"
    FUNCTION = "load_images"
    RETURN_TYPES = ("VIGGLE_REFERENCE_ANGLES", "IMAGE", "VIGGLE_REFERENCE_ANGLES", "IMAGE")
    RETURN_NAMES = ("reference_angles", "default_image", "body_reference_angles", "default_body_image")
    OUTPUT_TOOLTIPS = ("Head images and alpha masks by angle. Connect to Video Loader reference_angles.", "First head tab image for the standalone Ref Frame swap. Empty when the first tab is empty.", "Body images and alpha masks by angle. Connect to Video Loader body_reference_angles.", "First body tab image for the standalone Ref Frame body swap. Empty when the first tab is empty.")

    @classmethod
    def INPUT_TYPES(cls):
        settings = VKViggleLoadImage.INPUT_TYPES()["required"].copy()
        settings.pop("image")
        return {"required": {
            "angles": ("STRING", {"default": DEFAULT_ANGLES, "tooltip": "Selected character's head angles. Browse or From Input selects an image for the active tab; click its active name to rename. Empty collections are allowed."}),
            **settings,
        }, "optional": {
            "body_angles": ("STRING", {"default": DEFAULT_ANGLES, "tooltip": "Independent body angle tabs edited in the Body section. Empty unused tabs are allowed."}),
            **{f"body_{key}": value for key, value in settings.items()},
            "characters": ("STRING", {"default": "[]", "tooltip": "Workflow snapshot of all character datasets used by guides. Save stores the selected character in the local character library; resize settings are not part of a character."}),
        }}

    @classmethod
    def IS_CHANGED(cls, angles, body_angles=DEFAULT_ANGLES, **kwargs):
        characters = parse_characters(kwargs.get("characters", "[]"))
        return (tuple((angle["id"], angle["name"], angle["image"], LoadImage.IS_CHANGED(str(_input_path(angle["image"]))) if angle["image"] else None)
                      for value in (angles, body_angles, *(json.dumps(character[role]) for character in characters for role in ("head", "body"))) for angle in parse_angles(value)), tuple(sorted(kwargs.items())))

    @classmethod
    def VALIDATE_INPUTS(cls, angles, body_angles=DEFAULT_ANGLES, **kwargs):
        try:
            characters = parse_characters(kwargs.get("characters", "[]"))
            for angle in [*parse_angles(angles), *parse_angles(body_angles), *(angle for character in characters for role in ("head", "body") for angle in character[role])]:
                if angle["image"]:
                    _input_path(angle["image"])
        except (ValueError, OSError, KeyError, TypeError) as error:
            return str(error)
        return True

    def load_images(self, angles, resize_mode=RESIZE_BY_LARGEST_SIDE, longest_side=1920, megapixels=1.0, upscale=True,
                    body_angles=DEFAULT_ANGLES, body_resize_mode=RESIZE_BY_LARGEST_SIDE, body_longest_side=1920, body_megapixels=1.0, body_upscale=True, characters="[]"):
        datasets = parse_characters(characters)
        references = self._load_collection(angles, resize_mode, longest_side, megapixels, upscale)
        bodies = self._load_collection(body_angles, body_resize_mode, body_longest_side, body_megapixels, body_upscale)
        default, body_default = next(iter(references.values()), {}).get("image"), next(iter(bodies.values()), {}).get("image")
        for character in datasets:
            for role, collection, options in (("head", references, (resize_mode, longest_side, megapixels, upscale)),
                                               ("body", bodies, (body_resize_mode, body_longest_side, body_megapixels, body_upscale))):
                missing = [angle for angle in character[role] if angle["id"] not in collection]
                if missing:
                    collection.update(self._load_collection(json.dumps(missing), *options))
                for angle in character[role]:
                    collection[angle["id"]].update(character_id=character["id"], character_name=character["name"])
        return references, default, bodies, body_default

    @staticmethod
    def _load_collection(angles, resize_mode, longest_side, megapixels, upscale):
        references = {}
        loader = VKViggleLoadImage()
        for angle in parse_angles(angles):
            image, mask = None, None
            if angle["image"]:
                _input_path(angle["image"])
                image, mask, _, _, _ = loader.load_image(angle["image"], resize_mode, longest_side, megapixels, upscale)
            references[angle["id"]] = {"name": angle["name"], "image": image, "mask": mask}
        return references


NODE_CLASS_MAPPINGS = {"VKViggleLoadImage": VKViggleLoadImage, "VKViggleLoadMultipleImages": VKViggleLoadMultipleImages}
NODE_DISPLAY_NAME_MAPPINGS = {"VKViggleLoadImage": "VK Vigglorious Load Image", "VKViggleLoadMultipleImages": "VK Vigglorious Character Manager"}
