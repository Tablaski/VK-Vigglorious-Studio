from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .video_loader import VKViggleVideoLoader
from .viggle_load_image import VKViggleLoadImage, VKViggleLoadMultipleImages
from .refmod_scheduler import VKWrapperScheduleRefModApply, VKViggleRefModStepConditioning, VKViggleRefModAttentionApply
from .chunk_info import VKViggleChunkInfo
from .chunk_guides import VKViggleExtractChunkGuides, VKViggleExtractChunkFrames
from .guide_mask import VKViggleGuideMask
from .attention_masked_guide import VKAttentionMaskedGuide
from .sigma_scheduler import VKViggleSigmaScheduler
from . import video_routes

NODE_CLASS_MAPPINGS["VKViggleVideoLoader"] = VKViggleVideoLoader
NODE_DISPLAY_NAME_MAPPINGS["VKViggleVideoLoader"] = "VK Vigglorious Video Manager"
NODE_CLASS_MAPPINGS["VKViggleLoadImage"] = VKViggleLoadImage
NODE_DISPLAY_NAME_MAPPINGS["VKViggleLoadImage"] = "VK Vigglorious Load Image"
NODE_CLASS_MAPPINGS["VKWrapperScheduleRefModApply"] = VKWrapperScheduleRefModApply
NODE_DISPLAY_NAME_MAPPINGS["VKWrapperScheduleRefModApply"] = "VK Vigglorious Wrapper Schedule RefMod Apply"
NODE_CLASS_MAPPINGS["VKViggleRefModStepConditioning"] = VKViggleRefModStepConditioning
NODE_CLASS_MAPPINGS["VKViggleRefModAttentionApply"] = VKViggleRefModAttentionApply
NODE_DISPLAY_NAME_MAPPINGS["VKViggleRefModAttentionApply"] = "VK Vigglorious RefMod Attention Apply (internal)"
NODE_DISPLAY_NAME_MAPPINGS["VKViggleRefModStepConditioning"] = "VK Vigglorious RefMod Step Conditioning (internal)"
NODE_CLASS_MAPPINGS["VKViggleChunkInfo"] = VKViggleChunkInfo
NODE_DISPLAY_NAME_MAPPINGS["VKViggleChunkInfo"] = "VK Vigglorious Extract Chunk State"
NODE_CLASS_MAPPINGS["VKViggleExtractChunkGuides"] = VKViggleExtractChunkGuides
NODE_DISPLAY_NAME_MAPPINGS["VKViggleExtractChunkGuides"] = "VK Vigglorious Prepare Chunk Guides"
NODE_CLASS_MAPPINGS["VKViggleExtractChunkFrames"] = VKViggleExtractChunkFrames
NODE_DISPLAY_NAME_MAPPINGS["VKViggleExtractChunkFrames"] = "VK Vigglorious Extract Chunk Frames"
NODE_CLASS_MAPPINGS["VKAttentionMaskedGuide"] = VKAttentionMaskedGuide
NODE_DISPLAY_NAME_MAPPINGS["VKAttentionMaskedGuide"] = "VK Vigglorious Attention-Masked Guide"
NODE_CLASS_MAPPINGS["VKViggleSigmaScheduler"] = VKViggleSigmaScheduler
NODE_DISPLAY_NAME_MAPPINGS["VKViggleSigmaScheduler"] = "VK Vigglorious Sigma Scheduler"
NODE_CLASS_MAPPINGS["VKViggleLoadMultipleImages"] = VKViggleLoadMultipleImages
NODE_DISPLAY_NAME_MAPPINGS["VKViggleLoadMultipleImages"] = "VK Vigglorious Character Manager"
NODE_CLASS_MAPPINGS["VKViggleGuideMask"] = VKViggleGuideMask
NODE_DISPLAY_NAME_MAPPINGS["VKViggleGuideMask"] = "VK Vigglorious Guide Mask"
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
