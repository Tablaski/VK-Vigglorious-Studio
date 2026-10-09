import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

app.registerExtension({
    name: "VK.ViggleChunkStatus",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["VKViggleChunkInfo", "VKAttentionMaskedGuide"].includes(nodeData.name)) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = created?.apply(this, args);
            const widget = ComfyWidgets.STRING(this, "chunk_status",
                ["STRING", { multiline: true }], app).widget;
            widget.inputEl.readOnly = true;
            widget.options.serialize = false;
            widget.value = nodeData.name === "VKAttentionMaskedGuide" ? "Waiting for guide conditioning" : "Waiting for chunk conditioning";
            this.vkChunkStatusWidget = widget;
            if (nodeData.name === "VKAttentionMaskedGuide") {
                this.hideOutputImages = true;
                const previews = document.createElement("div");
                previews.style.cssText = "height:300px;min-height:300px;max-height:300px;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;padding:4px;background:var(--comfy-input-bg);";
                previews.setAttribute("aria-label", "Guide and mask previews");
                previews.title = "Scroll to inspect the current chunk's guides and mask overlays.";
                const empty = () => { previews.textContent = "No guide previews for this chunk."; };
                empty();
                const panel = this.addDOMWidget("guide_previews", "guide_previews", previews, {
                    hideOnZoom: false,
                    getMinHeight: () => 300,
                    getMaxHeight: () => 300,
                    getHeight: () => 300,
                });
                panel.serialize = false;
                const executed = this.onExecuted;
                this.onExecuted = function (message, ...args) {
                    const result = executed?.call(this, message, ...args);
                    previews.replaceChildren();
                    for (const [index, image] of (message.images || []).entries()) {
                        const preview = document.createElement("img");
                        const query = new URLSearchParams({filename:image.filename, subfolder:image.subfolder || "", type:image.type || "temp"});
                        preview.src = api.apiURL(`/view?${query}`);
                        preview.alt = `Guide ${index + 1} with mask overlays`;
                        preview.style.cssText = "display:block;width:100%;height:260px;object-fit:contain;margin-bottom:8px;";
                        previews.append(preview);
                    }
                    if (!previews.childElementCount) empty();
                    previews.scrollTop = 0;
                    return result;
                };
                this.setSize([this.size[0], Math.max(this.size[1], this.computeSize()[1])]);
            }
            return result;
        };
    },
    setup() {
        const active = new Map();
        api.addEventListener("vk.viggle_chunk_status", ({ detail }) => {
            const node = app.graph.getNodeById(detail.node_id);
            if (!node?.vkChunkStatusWidget) return;
            node.vkChunkStatusWidget.value = detail.text;
            active.set(node, detail.prompt_id);
            app.graph.setDirtyCanvas(true, true);
        });
        for (const event of ["execution_error", "execution_interrupted", "execution_success"]) {
            api.addEventListener(event, ({ detail }) => {
                for (const [node, promptId] of active) {
                    if (promptId !== detail.prompt_id) continue;
                    node.vkChunkStatusWidget.value += event === "execution_success"
                        ? "\nRun completed." : "\nRun stopped.";
                    active.delete(node);
                }
                app.graph.setDirtyCanvas(true, true);
            });
        }
        api.addEventListener("execution_start", () => active.clear());
    },
});
