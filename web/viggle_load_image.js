import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";


const PAGE_SIZE = 24;
const IMAGE_EXTENSIONS = /\.(bmp|gif|jpe?g|png|tiff?|webp)$/i;


function installStyles() {
    if (document.getElementById("viggle-load-image-styles")) {
        return;
    }
    const style = document.createElement("style");
    style.id = "viggle-load-image-styles";
    style.textContent = `
        .vkvgli-panel { height: 100%; display: flex; flex-direction: column; gap: 8px; padding: 4px; box-sizing: border-box; font: 12px sans-serif; color: var(--fg-color, #ddd); }
        .vkvgli-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .vkvgli-button { min-height: 28px; border: 1px solid #555; border-radius: 5px; color: inherit; background: #333; cursor: pointer; }
        .vkvgli-button:hover { background: #444; }
        .vkvgli-preview { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; border-radius: 6px; background: #171717; border: 1px solid #3d3d3d; }
        .vkvgli-preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: none; }
        .vkvgli-empty { padding: 18px; text-align: center; color: #8d8d8d; }
        .vkvgli-arrow { position: absolute; z-index: 2; top: 50%; width: 34px; height: 54px; transform: translateY(-50%); border: 0; border-radius: 6px; color: white; background: rgba(0,0,0,.58); font-size: 28px; cursor: pointer; }
        .vkvgli-arrow:first-of-type { left: 7px; }
        .vkvgli-arrow:last-of-type { right: 7px; }
        .vkvgli-arrow:disabled { opacity: .2; cursor: default; }
        .vkvgli-name { height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; color: #aaa; }
        .vkvgli-gallery-backdrop { position: fixed; z-index: 100000; inset: 0; display: grid; place-items: center; padding: 28px; background: rgba(0,0,0,.72); }
        .vkvgli-gallery { width: min(1100px, 94vw); height: min(820px, 90vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #555; border-radius: 10px; background: #202020; color: #eee; box-shadow: 0 18px 65px rgba(0,0,0,.65); font: 13px sans-serif; }
        .vkvgli-gallery-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #414141; }
        .vkvgli-gallery-title { flex: 1; font-size: 16px; font-weight: 600; }
        .vkvgli-gallery-count { color: #999; }
        .vkvgli-gallery-close { width: 32px; height: 30px; border: 0; border-radius: 5px; color: #ddd; background: #383838; font-size: 20px; cursor: pointer; }
        .vkvgli-gallery-scroll { flex: 1; overflow: auto; padding: 12px; }
        .vkvgli-gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
        .vkvgli-card { min-width: 0; padding: 0; overflow: hidden; border: 1px solid #444; border-radius: 7px; color: #ddd; background: #292929; cursor: pointer; text-align: left; }
        .vkvgli-card:hover { border-color: #8d79ff; background: #343434; }
        .vkvgli-thumb { width: 100%; aspect-ratio: 1; display: block; object-fit: cover; background: #151515; }
        .vkvgli-card-name { padding: 7px 8px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vkvgli-card-date { padding: 0 8px 7px; color: #8f8f8f; font-size: 11px; }
        .vkvgli-sentinel { min-height: 42px; display: grid; place-items: center; color: #999; }
        .vkvgli-manager { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; padding:10px; height:100%; min-height:0; overflow:auto; box-sizing:border-box; background:#191b20; color:#ddd; font:12px sans-serif; border-radius:8px; }
        .vkvgli-collection { display:flex; flex-direction:column; min-width:0; min-height:330px; gap:6px; }
        .vkvgli-collection .vkvgli-panel { flex:1; min-height:240px; height:auto; }
        .vkvgli-collection .vkvgli-name { white-space:normal; overflow-wrap:anywhere; height:auto; min-height:18px; }
        .vkvgli-character-header,.vkvgli-performance { grid-column:1/-1; display:flex; flex-direction:column; gap:8px; }
        .vkvgli-characters { display:flex; gap:8px; overflow:auto; padding-bottom:4px; min-height:112px; }
        .vkvgli-character { flex:0 0 100px; padding:4px; display:flex; flex-direction:column; gap:5px; }
        .vkvgli-character img { width:100%; height:74px; object-fit:cover; border-radius:3px; }
        .vkvgli-character[aria-pressed=true] { border-color:#a68aff; box-shadow:0 0 0 1px #a68aff; }
        .vkvgli-character-edit { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
        .vkvgli-character-edit input { flex:1; min-width:120px; }
        .vkvgli-character-status { color:#eab96a; min-height:16px; }
        .vkvgli-tabs button[data-empty=true] { color:#eab96a; border-color:#936e36; }
        .vkvgli-tabs button[data-empty=false] { color:#8bd8ad; }
        .vkvgli-performance { border-top:1px solid #454952; padding-top:8px; }
        .vkvgli-global-fields { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
        .vkvgli-performance label { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
        .vkvgli-performance input[type=checkbox] { align-self:start; }
        .vkvgli-manager input,.vkvgli-manager select { background:#30343e; color:#eee; border:1px solid #555; border-radius:4px; padding:5px; min-width:0; }
        .vkvgli-angle-menu { display:flex; gap:5px; flex-wrap:wrap; }
    `;
    document.head.appendChild(style);
}


function inputViewUrl(name) {
    const normalized = name.replace(/\\/g, "/");
    const separator = normalized.lastIndexOf("/");
    const filename = separator < 0 ? normalized : normalized.slice(separator + 1);
    const subfolder = separator < 0 ? "" : normalized.slice(0, separator);
    const query = new URLSearchParams({ filename, type: "input", preview: "webp;90", channel: "rgb" });
    if (subfolder) {
        query.set("subfolder", subfolder);
    }
    return api.apiURL(`/view?${query.toString()}`);
}


function thumbnailUrl(item) {
    const query = new URLSearchParams({ image: item.name, v: String(item.mtime) });
    return api.apiURL(`/vk-nodes/viggle-load-image/thumbnail?${query.toString()}`);
}


function angleTabs(node) {
    return JSON.parse(node.widgets.find(widget => widget.name === "angles").value);
}

function activeAngle(node) {
    const tabs = angleTabs(node);
    return tabs.find(tab => tab.id === node.properties.vkViggleActiveAngle) || tabs[0];
}

function saveAngles(node, tabs) {
    node.widgets.find(widget => widget.name === "angles").value = JSON.stringify(tabs);
    node._vkAnglesChanged?.(tabs);
    node._vkRenderAngleTabs?.();
    node.graph?.setDirtyCanvas(true, true);
    document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail: node}));
}

function imageWidget(node) {
    if (node.comfyClass === "VKViggleLoadMultipleImages" || node._vkViggleMultiple) {
        return { get value() { return activeAngle(node)?.image; } };
    }
    return node.widgets?.find((widget) => widget.name === "image");
}


async function refreshNeighbors(node, name) {
    const state = node._vkViggleLoadImage;
    if (!state) {
        return;
    }
    const token = ++state.neighborToken;
    state.previous = null;
    state.next = null;
    state.left.disabled = true;
    state.right.disabled = true;
    if (!name) {
        return;
    }
    try {
        const query = new URLSearchParams({ image: name });
        const response = await api.fetchApi(`/vk-nodes/viggle-load-image/neighbors?${query.toString()}`);
        const payload = await response.json();
        if (!response.ok || token !== state.neighborToken) {
            return;
        }
        state.previous = payload.previous;
        state.next = payload.next;
        state.left.disabled = !state.previous;
        state.right.disabled = !state.next;
    } catch (error) {
        console.error("[VK Viggle Load Image] Could not load neighboring images.", error);
    }
}


function showSelection(node) {
    const state = node._vkViggleLoadImage;
    const name = imageWidget(node)?.value || "";
    if (!state) {
        return;
    }
    if (!name) {
        ++state.previewToken;
        state.image.onload = null;
        state.image.onerror = null;
        state.image.removeAttribute("src");
        state.image.style.display = "none";
        state.empty.style.display = "";
        state.empty.textContent = node._vkEmptyHint || "Browse, choose From Input, or drop an image here";
        state.label.textContent = "No image selected";
    } else {
        const token = ++state.previewToken;
        state.label.textContent = name;
        state.image.onload = () => {
            if (token !== state.previewToken) {
                return;
            }
            state.image.style.display = "block";
            state.empty.style.display = "none";
            state.label.textContent = `${name} · ${state.image.naturalWidth} × ${state.image.naturalHeight}`;
            state.label.title = state.label.textContent;
        };
        state.image.onerror = () => {
            if (token !== state.previewToken) {
                return;
            }
            state.image.style.display = "none";
            state.empty.style.display = "";
            state.empty.textContent = "Preview unavailable";
            state.label.textContent = `${name} · resolution unavailable`;
        };
        state.image.style.display = "none";
        state.empty.style.display = "";
        state.empty.textContent = "Loading preview…";
        state.image.src = inputViewUrl(name);
        state.label.title = name;
    }
    if (!node._vkViggleMultiple) refreshNeighbors(node, name);
}


function selectImage(node, name, angleId) {
    if (node._vkSetImage) { node._vkSetImage(name, angleId || activeAngle(node)?.id); return; }
    if (node._vkViggleMultiple) {
        const tabs = angleTabs(node);
        const tab = tabs.find(tab => tab.id === (angleId || activeAngle(node)?.id));
        if (!tab) return;
        tab.image = name;
        saveAngles(node, tabs);
        showSelection(node);
        return;
    }
    const widget = imageWidget(node);
    if (!widget) {
        return;
    }
    widget.value = name;
    widget.callback?.(name);
    showSelection(node);
    node.graph?.setDirtyCanvas(true, true);
}


async function uploadImage(node, file, pasted = false) {
    if (!file || (!file.type?.startsWith("image/") && !IMAGE_EXTENSIONS.test(file.name || ""))) {
        return false;
    }
    const angleId = node._vkViggleMultiple ? activeAngle(node)?.id : null;
    if (node._vkViggleMultiple && !angleId) throw new Error("Add an angle before uploading an image.");
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    if (pasted) body.append("subfolder", "pasted");
    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) {
        throw new Error(`Upload failed (${response.status}).`);
    }
    const result = await response.json();
    const name = result.subfolder ? `${result.subfolder.replace(/\\/g, "/")}/${result.name}` : result.name;
    selectImage(node, name, angleId);
    return true;
}


function installFileHandlers(node, target = () => node) {
    const onDragOver = node.onDragOver;
    const onDragDrop = node.onDragDrop;
    const pasteFiles = node.pasteFiles;
    const validFile = (file) => file && (file.type?.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name || ""));
    const uploadFirst = (files) => {
        const file = [...(files || [])].find(validFile);
        if (!file) {
            return false;
        }
        uploadImage(target(), file, true).catch((error) => alert(error.message));
        return true;
    };

    node.onDragOver = function (event) {
        if (event?.dataTransfer?.items && [...event.dataTransfer.items].some((item) => item.kind === "file")) {
            return true;
        }
        return onDragOver?.apply(this, arguments) ?? false;
    };
    node.onDragDrop = async function (event) {
        const file = [...(event?.dataTransfer?.files || [])].find(validFile);
        if (!file) {
            return await onDragDrop?.apply(this, arguments) ?? false;
        }
        try {
            return await uploadImage(target(), file);
        } catch (error) {
            alert(error.message);
            return true;
        }
    };
    node.pasteFiles = function (files) {
        return uploadFirst(files) || pasteFiles?.apply(this, arguments) || false;
    };
}


function openGallery(node) {
    const angleId = node._vkViggleMultiple ? activeAngle(node)?.id : null;
    if (node._vkViggleMultiple && !angleId) {alert("Add an angle before choosing an image."); return;}
    const backdrop = document.createElement("div");
    backdrop.className = "vkvgli-gallery-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "vkvgli-gallery";
    const head = document.createElement("div");
    head.className = "vkvgli-gallery-head";
    const title = document.createElement("div");
    title.className = "vkvgli-gallery-title";
    title.textContent = "ComfyUI input images";
    const count = document.createElement("div");
    count.className = "vkvgli-gallery-count";
    const closeButton = document.createElement("button");
    closeButton.className = "vkvgli-gallery-close";
    closeButton.textContent = "×";
    closeButton.title = "Close";
    head.append(title, count, closeButton);
    const scroll = document.createElement("div");
    scroll.className = "vkvgli-gallery-scroll";
    const grid = document.createElement("div");
    grid.className = "vkvgli-gallery-grid";
    const sentinel = document.createElement("div");
    sentinel.className = "vkvgli-sentinel";
    sentinel.textContent = "Loading…";
    scroll.append(grid, sentinel);
    dialog.append(head, scroll);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let offset = 0;
    let loading = false;
    let hasMore = true;

    const imageObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                const image = entry.target;
                image.src = image.dataset.src;
                delete image.dataset.src;
                imageObserver.unobserve(image);
            }
        }
    }, { root: scroll, rootMargin: "80px" });

    const close = () => {
        imageObserver.disconnect();
        scroll.removeEventListener("scroll", onScroll);
        document.removeEventListener("keydown", onKeyDown);
        backdrop.remove();
        if (node._vkViggleLoadImage?.closeGallery === close) {
            node._vkViggleLoadImage.closeGallery = null;
        }
    };
    const onKeyDown = (event) => {
        if (event.key === "Escape") {
            close();
        }
    };
    closeButton.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
            close();
        }
    });
    document.addEventListener("keydown", onKeyDown);
    node._vkViggleLoadImage.closeGallery?.();
    node._vkViggleLoadImage.closeGallery = close;

    const addItem = (item) => {
        const card = document.createElement("button");
        card.className = "vkvgli-card";
        card.title = item.name;
        const image = document.createElement("img");
        image.className = "vkvgli-thumb";
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.dataset.src = thumbnailUrl(item);
        const name = document.createElement("div");
        name.className = "vkvgli-card-name";
        name.textContent = item.name;
        const date = document.createElement("div");
        date.className = "vkvgli-card-date";
        date.textContent = new Date(item.used_at * 1000).toLocaleString();
        card.append(image, name, date);
        card.addEventListener("click", () => {
            selectImage(node, item.name, angleId);
            close();
        });
        grid.appendChild(card);
        imageObserver.observe(image);
    };

    const loadMore = async () => {
        if (loading || !hasMore) {
            return;
        }
        loading = true;
        sentinel.textContent = "Loading…";
        try {
            const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
            const response = await api.fetchApi(`/vk-nodes/viggle-load-image/gallery?${query.toString()}`);
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || "Gallery request failed.");
            }
            payload.items.forEach(addItem);
            offset += payload.items.length;
            hasMore = payload.has_more;
            count.textContent = `${payload.total.toLocaleString()} image${payload.total === 1 ? "" : "s"}`;
            sentinel.textContent = hasMore ? "Scroll to load more" : (payload.total ? "End of gallery" : "The input folder is empty");
        } catch (error) {
            sentinel.textContent = error.message;
        } finally {
            loading = false;
        }
    };

    const onScroll = () => {
        if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 160) {
            loadMore();
        }
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    sentinel.addEventListener("click", loadMore);
    loadMore();
}


function buildPanel(node, container = null) {
    const root = document.createElement("div");
    root.className = "vkvgli-panel";
    const actions = document.createElement("div");
    actions.className = "vkvgli-actions";
    const browse = document.createElement("button");
    browse.className = "vkvgli-button";
    browse.textContent = "Browse…";
    const fromInput = document.createElement("button");
    fromInput.className = "vkvgli-button";
    fromInput.textContent = "From Input";
    actions.append(browse, fromInput);

    const preview = document.createElement("div");
    preview.className = "vkvgli-preview";
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    const empty = document.createElement("div");
    empty.className = "vkvgli-empty";
    empty.textContent = "Browse, choose From Input, or drop an image here";
    preview.append(image, empty);
    const label = document.createElement("div");
    label.className = "vkvgli-name";
    label.textContent = "No image selected";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    root.append(actions, preview, label, fileInput);
    if (node._vkViggleMultiple) buildAngleTabs(node, root);

    node._vkViggleLoadImage = { image, empty, label, previewToken: 0, closeGallery: null };
    if (!node._vkViggleMultiple) {
        const left = document.createElement("button");
        left.className = "vkvgli-arrow";
        left.textContent = "‹";
        left.title = "Newer image";
        const right = document.createElement("button");
        right.className = "vkvgli-arrow";
        right.textContent = "›";
        right.title = "Older image";
        left.disabled = right.disabled = true;
        preview.append(left, right);
        Object.assign(node._vkViggleLoadImage, {left, right, previous: null, next: null, neighborToken: 0});
        left.addEventListener("click", () => {
            if (node._vkViggleLoadImage.previous) selectImage(node, node._vkViggleLoadImage.previous);
        });
        right.addEventListener("click", () => {
            if (node._vkViggleLoadImage.next) selectImage(node, node._vkViggleLoadImage.next);
        });
    }
    browse.addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
        try {
            await uploadImage(node, fileInput.files?.[0]);
        } catch (error) {
            alert(error.message);
        }
    });
    fromInput.addEventListener("click", () => openGallery(node));
    root.addEventListener("dragover", (event) => {
        if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === "file")) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
        }
    });
    root.addEventListener("drop", (event) => {
        const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/") || IMAGE_EXTENSIONS.test(item.name));
        if (!file) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        uploadImage(node, file).catch((error) => alert(error.message));
    });

    if (container) {
        container.append(root);
        showSelection(node);
        return;
    }
    const domWidget = node.addDOMWidget("viggle_load_image_panel", "viggle_load_image_panel", root, {
        hideOnZoom: false,
        margin: 4,
        hideInPanel: true,
        getValue: () => undefined,
        setValue: () => {},
        getMinHeight: () => 120,
    });
    domWidget.serialize = false;
    domWidget.serializeValue = () => undefined;
    node.setSize([Math.max(node.size[0], 330), Math.max(node.size[1], 380)]);
    showSelection(node);
}


function buildReferenceManager(node) {
    const root = document.createElement("div");
    root.className = "vkvgli-manager";
    const views = {};
    const header = document.createElement("div"); header.className = "vkvgli-character-header";
    const gallery = document.createElement("div"); gallery.className = "vkvgli-characters";
    gallery.setAttribute("aria-label", "Character gallery");
    const edit = document.createElement("div"); edit.className = "vkvgli-character-edit";
    const name = document.createElement("input"); name.setAttribute("aria-label", "Character label"); name.title = "Label used in the gallery and guide angle selectors.";
    const action = (label, title, handler) => {
        const button = document.createElement("button"); button.className = "vkvgli-button";
        button.textContent = label; button.title = title; button.onclick = handler; return button;
    };
    const status = document.createElement("div"); status.className = "vkvgli-character-status"; status.setAttribute("role", "status");
    header.append(gallery, edit, status); root.append(header);
    const performance = document.createElement("details"); performance.className = "vkvgli-performance";
    const summary = document.createElement("summary"); summary.textContent = "Global resize · performance";
    summary.title = "Node settings shared by every character. These settings are excluded from character saves.";
    const performanceOptions = document.createElement("div"); performanceOptions.className = "vkvgli-performance-options";
    performance.append(summary, performanceOptions);
    for (const [role, prefix] of [["Head", ""], ["Body", "body_"]]) {
        const section = document.createElement("section");
        section.className = "vkvgli-collection";
        const label = role === "Body" ? "Full body" : role;
        section.setAttribute("aria-label", `${label} reference angles`);
        const heading = document.createElement("strong"); heading.textContent = label;
        section.append(heading); root.append(section);
        node.properties[`vkViggle${role}Angles`] ??= {};
        const view = {
            _vkViggleMultiple: true,
            _vkEmptyHint: role === "Body" ? "Optional for Head swaps. Choose an image for Full body swaps." : "Browse, choose From Input, or drop an image here",
            properties: node.properties[`vkViggle${role}Angles`],
            get graph() { return node.graph; },
            widgets: ["angles", "resize_mode", "longest_side", "megapixels", "upscale"].flatMap(name => {
                const field = node.widgets.find(widget => widget.name === prefix + name);
                if (!field) return [];
                return [{name, get value() {return field.value;}, set value(value) {field.value = value;}}];
            }),
        };
        views[role] = view;
        buildPanel(view, section);
        section.addEventListener("pointerdown", () => {node.properties.vkViggleReferenceRole = role;});
        const resizeHeading = document.createElement("strong"); resizeHeading.textContent = `${label} resize`;
        performanceOptions.append(resizeHeading);
        const settings = document.createElement("div"); settings.className = "vkvgli-global-fields";
        for (const name of ["resize_mode", "longest_side", "megapixels", "upscale"]) {
            const field = node.widgets.find(widget => widget.name === prefix + name);
            if (!field) continue;
            const label = document.createElement("label");
            label.textContent = {resize_mode:"Resize", longest_side:"Longest side · px", megapixels:"Megapixels", upscale:"Allow upscale"}[name];
            label.title = field.tooltip || field.options?.tooltip || label.textContent;
            const input = document.createElement(name === "resize_mode" ? "select" : "input");
            if (name === "resize_mode") for (const value of field.options?.values || ["resize by largest side", "scale to megapixels", "none"]) {
                const option = document.createElement("option"); option.value = option.textContent = value; input.append(option);
            }
            else {input.type = name === "upscale" ? "checkbox" : "number"; input.min = field.options?.min ?? 0.01; input.step = name === "megapixels" ? 0.01 : 1;}
            input.dataset.setting = prefix + name;
            input.setAttribute("aria-label", `${role === "Body" ? "Full body" : role} ${label.textContent}`);
            input.onchange = () => {field.value = input.type === "checkbox" ? input.checked : input.tagName === "SELECT" ? input.value : Number(input.value); field.callback?.(field.value); node.graph?.setDirtyCanvas(true,true);};
            label.append(input); settings.append(label);
        }
        performanceOptions.append(settings);
    }
    root.append(performance);
    const charactersWidget = node.widgets.find(widget => widget.name === "characters");
    const snapshot = () => JSON.parse(charactersWidget.value || "[]");
    let characters = [], saved = new Map(), busy = false;
    const current = () => characters.find(character => !character.archived && character.id === node.properties.vkViggleCharacter) || characters.find(character=>!character.archived);
    const persist = () => {
        charactersWidget.value = JSON.stringify(characters);
        node.graph?.setDirtyCanvas(true,true);
    };
    function renderCharacters(rebuild = true) {
        if (rebuild) {
            gallery.replaceChildren();
            for (const character of characters.filter(character=>!character.archived)) {
                const button = action(character.name, "Select this character for new guides. Double-click to rename it. Existing guides keep their references.", () => selectCharacter(character.id));
                button.ondblclick = event => {event.stopPropagation(); name.focus(); name.select();};
                button.classList.add("vkvgli-character"); button.dataset.character = character.id;
                const front = character.head.find(angle => angle.name.toLowerCase() === "front") || character.head[0];
                if (front?.image) {const image = document.createElement("img"); image.src = inputViewUrl(front.image); image.alt = `${character.name} · front`; button.prepend(image);}
                else {const empty = document.createElement("span"); empty.style.cssText = "height:74px;display:grid;place-items:center;color:#eab96a"; empty.textContent = "Front empty"; button.prepend(empty);}
                gallery.append(button);
            }
        }
        for (const button of gallery.children) button.setAttribute("aria-pressed",String(button.dataset.character === current().id));
        if (document.activeElement !== name) name.value = current().name;
        status.textContent = saved.get(current().id) === JSON.stringify(current()) ? "Saved locally · green: image present · amber: empty angle" : "Unsaved changes · green: image present · amber: empty angle";
    }
    function selectCharacter(id) {
        for (const view of Object.values(views)) view._vkViggleLoadImage?.closeGallery?.();
        node.properties.vkViggleCharacter = id;
        const character = current();
        for (const [role,view] of Object.entries(views)) {
            const key = role === "Head" ? "head" : "body";
            view.widgets.find(widget => widget.name === "angles").value = JSON.stringify(character[key]);
            view.properties.vkViggleActiveAngle = character[key].some(angle => angle.id === view.properties.vkViggleActiveAngle) ? view.properties.vkViggleActiveAngle : character[key][0]?.id;
            view._vkRenderAngleTabs?.(); showSelection(view);
        }
        persist(); renderCharacters(gallery.children.length !== characters.filter(character=>!character.archived).length || ![...gallery.children].some(button=>button.dataset.character===character.id));
        document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:node}));
    }
    for (const [role,view] of Object.entries(views)) {
        const key = role === "Head" ? "head" : "body";
        view._vkAnglesChanged = tabs => {current()[key] = tabs; persist(); renderCharacters();};
        view._vkSetImage = (image, id) => {
            const character = characters.find(item => item[key].some(angle => angle.id === id));
            if (!character) return;
            character[key].find(angle => angle.id === id).image = image;
            if (character === current()) view.widgets.find(widget => widget.name === "angles").value = JSON.stringify(character[key]);
            persist(); renderCharacters(); view._vkRenderAngleTabs?.(); showSelection(view);
            document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:node}));
        };
    }
    name.oninput = () => {if (name.value.trim()) {current().name = name.value; persist(); renderCharacters(); document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:node}));}};
    name.onchange = () => {if (name.value.trim()) {current().name = name.value.trim(); persist(); renderCharacters(); document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:node}));}};
    name.onkeydown = event => {
        event.stopPropagation();
        if (event.key === "Enter") {event.preventDefault(); name.onchange(); name.blur();}
    };
    const newCharacter = () => ({id:crypto.randomUUID(), name:"New character", head:["front","side"].map(name=>({id:crypto.randomUUID(),name,image:""})), body:["front","side"].map(name=>({id:crypto.randomUUID(),name,image:""}))});
    async function libraryRequest(character, remove = false) {
        if (busy) return;
        busy = true;
        try {
            const response = await api.fetchApi("/vk-nodes/viggle-characters", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({character,delete:remove})});
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Cannot save character library.");
            saved = new Map(payload.characters.map(item=>[item.id,JSON.stringify(item)]));
            if (remove) {
                characters.find(item=>item.id===character.id).archived = true;
                if (!characters.some(item=>!item.archived)) characters.push(newCharacter());
                selectCharacter(current().id);
            } else renderCharacters();
        } catch (error) {status.textContent = error.message;} finally {busy = false;}
    }
    edit.append(name,
        action("+ New", "Create a character with empty Front and Side angles for Head and Full body.", () => {if (busy) return; const character=newCharacter(); characters.push(character); selectCharacter(character.id);}),
        action("Clone character", "Create an independent copy of this character's head and body angles using the same image files. Edit the copy, then save it under its own label. Existing guides keep the original character.", () => {
            if (busy) return;
            name.onchange();
            const original = current();
            const character = {id:crypto.randomUUID(), name:`${original.name} copy`,
                head:original.head.map(angle=>({...angle,id:crypto.randomUUID()})),
                body:original.body.map(angle=>({...angle,id:crypto.randomUUID()}))};
            characters.push(character); selectCharacter(character.id);
            name.focus(); name.select();
        }),
        action("Save character", "Save this character's label and images in the local library. Global resize settings stay on this node.", () => {name.onchange(); libraryRequest(structuredClone(current()));}),
        action("Delete character", "Remove this character from the gallery and local library. Existing workflow guides keep their references; image files are kept.", () => {
            if (confirm(`Delete character “${current().name}” from the gallery and library? Existing guides and image files are kept.`)) libraryRequest(structuredClone(current()),true);
        }));
    node._vkCharacterManager = {
        getSelectedCharacter() {
            const character = current();
            const front = character.head.find(angle => angle.name.toLowerCase() === "front") || character.head[0];
            return {name:character.name, image:front?.image || ""};
        },
        getAngles(body, selectedOnly = false) {
            const role = body ? "body" : "head";
            if (selectedOnly) return current()[role].map(angle=>({...angle,character_id:current().id,character_name:current().name}));
            return characters.flatMap(character => character[role].map(angle=>({...angle, name:characters.length > 1 ? `${character.name} · ${angle.name}` : angle.name, character_id:character.id, character_name:character.name})));
        },
    };
    const panel = node.addDOMWidget("viggle_reference_manager", "viggle_reference_manager", root, {
        hideOnZoom:false, getValue:() => undefined, setValue:() => {}, getMinHeight:() => 570,
    });
    panel.serialize = false; panel.serializeValue = () => undefined;
    const restore = () => {
        for (const [role,view] of Object.entries(views)) {
            view.properties = node.properties[`vkViggle${role}Angles`] ||= {};
            view._vkRenderAngleTabs?.(); showSelection(view);
        }
        for (const input of root.querySelectorAll("[data-setting]")) {
            const field = node.widgets.find(widget => widget.name === input.dataset.setting);
            if (input.type === "checkbox") input.checked = Boolean(field.value); else input.value = field.value;
        }
        characters = snapshot();
        if (!characters.length) {
            const character = newCharacter(); character.name = "Character 1";
            character.head = angleTabs(views.Head); character.body = angleTabs(views.Body);
            characters.push(character);
        }
        renderCharacters(); selectCharacter(current().id);
    };
    for (const field of node.widgets.filter(widget => ["characters","angles","body_angles","resize_mode","longest_side","megapixels","upscale","body_resize_mode","body_longest_side","body_megapixels","body_upscale"].includes(widget.name))) {
        field.hidden = true; field.type = "hidden"; field.computeSize = () => [0,-4];
        const callback = field.callback;
        field.callback = value => {callback?.call(field,value); restore(); document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:node}));};
    }
    installFileHandlers(node, () => views[node.properties.vkViggleReferenceRole] || views.Head);
    node._vkReferenceManager = {restore, dispose:() => {for (const view of Object.values(views)) view._vkViggleLoadImage?.closeGallery?.(); root.remove();}};
    node.setSize([Math.max(node.size[0],700), Math.max(node.size[1],650)]);
    restore();
    api.fetchApi("/vk-nodes/viggle-characters").then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Cannot read character library.");
        saved = new Map(payload.characters.map(character=>[character.id,JSON.stringify(character)]));
        const used = new Set(characters.map(character=>character.id));
        const angleIds = {head:new Set(characters.flatMap(character=>character.head.map(angle=>angle.id))), body:new Set(characters.flatMap(character=>character.body.map(angle=>angle.id)))};
        for (const character of payload.characters.filter(character=>!used.has(character.id))) {
            for (const role of ["head","body"]) for (const angle of character[role]) {
                while (angleIds[role].has(angle.id)) angle.id = `${character.id}:${angle.id}`;
                angleIds[role].add(angle.id);
            }
            characters.push(character);
        }
        persist(); renderCharacters();
        document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:node}));
    }).catch(error=>{status.textContent = error.message;});
}


function buildAngleTabs(node, root) {
    const bar = document.createElement("div");
    bar.className = "vkvgli-tabs";
    bar.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0";
    root.prepend(bar);
    const clear = document.createElement("button"); clear.className = "vkvgli-button vkvgli-remove-image"; clear.textContent = "Remove image";
    clear.title = "Clear the selected angle's image without deleting the angle or image file.";
    clear.onclick = () => {selectImage(node,"",activeAngle(node).id);};
    root.querySelector(".vkvgli-name").after(clear);
    function render() {
        bar.replaceChildren();
        const tabs = angleTabs(node), active = activeAngle(node);
        clear.disabled = !active?.image;
        for (const tab of tabs) {
            const button = document.createElement("button");
            button.className = "vkvgli-button";
            button.textContent = tab.name;
            button.dataset.empty = String(!tab.image);
            button.setAttribute("aria-pressed", String(tab.id === active?.id));
            button.title = `${tab.image ? "Image present" : "Empty angle"}. Select angle; click the active tab again to rename.`;
            if (tab.id === active?.id) button.style.borderColor = "#8d79ff";
            button.onclick = () => {
                if (tab.id === activeAngle(node)?.id) {
                    const input = document.createElement("input");
                    input.value = tab.name; input.setAttribute("aria-label", "Angle name");
                    button.replaceWith(input); input.focus(); input.select();
                    let finished = false;
                    const finish = commit => {
                        if (finished) return;
                        finished = true;
                        if (commit && input.value.trim()) {
                            tab.name = input.value.trim(); saveAngles(node, tabs);
                        }
                        render();
                    };
                    input.onblur = () => finish(true);
                    input.onkeydown = event => {
                        event.stopPropagation();
                        if (event.key === "Enter") finish(true);
                        if (event.key === "Escape") finish(false);
                    };
                } else {
                    node._vkViggleLoadImage?.closeGallery?.();
                    node.properties.vkViggleActiveAngle = tab.id;
                    render(); showSelection(node);
                    node.graph?.setDirtyCanvas(true, true);
                }
            };
            bar.append(button);
        }
        const add = document.createElement("button");
        add.className = "vkvgli-button"; add.textContent = "+"; add.title = "Add a reference angle.";
        add.onclick = () => {
            node._vkViggleLoadImage?.closeGallery?.();
            const existing = bar.querySelector(".vkvgli-angle-menu");
            if (existing) {existing.remove(); return;}
            const menu = document.createElement("div"); menu.className = "vkvgli-angle-menu";
            const presets = document.createElement("select"); presets.setAttribute("aria-label", "New angle preset");
            for (const name of ["front","side","three-quarter left","three-quarter right","side left","side right","back","high angle","low angle","Custom…"]) {
                const option = document.createElement("option"); option.value = option.textContent = name; presets.append(option);
            }
            const custom = document.createElement("input"); custom.placeholder = "Custom angle label"; custom.setAttribute("aria-label", "Custom angle label"); custom.hidden = true;
            presets.onchange = () => {custom.hidden = presets.value !== "Custom…";};
            const create = document.createElement("button"); create.textContent = "Add angle"; create.className = "vkvgli-button";
            create.onclick = () => {
                const name = presets.value === "Custom…" ? custom.value.trim() : presets.value;
                if (!name) return;
                const tab = {id:crypto.randomUUID(),name,image:""}; tabs.push(tab); node.properties.vkViggleActiveAngle = tab.id;
                saveAngles(node,tabs); render(); showSelection(node);
            };
            menu.append(presets,custom,create); bar.append(menu);
        };
        const remove = document.createElement("button");
        remove.className = "vkvgli-button"; remove.textContent = "−";
        remove.title = "Remove the active angle. Guides using it must be reassigned.";
        remove.disabled = tabs.length === 0;
        remove.onclick = () => {
            node._vkViggleLoadImage?.closeGallery?.();
            const remaining = tabs.filter(tab => tab.id !== active.id);
            node.properties.vkViggleActiveAngle = remaining[0]?.id;
            saveAngles(node, remaining); render(); showSelection(node);
        };
        bar.append(add, remove);
    }
    node._vkRenderAngleTabs = render;
    render();
}


app.registerExtension({
    name: "VK.ViggleLoadImage",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["VKViggleLoadImage", "VKViggleLoadMultipleImages"].includes(nodeData.name)) {
            return;
        }
        installStyles();

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            this.previewMediaType = "image";
            this._vkViggleMultiple = nodeData.name === "VKViggleLoadMultipleImages";
            this.properties ||= {};
            if (this._vkViggleMultiple && this.widgets.some(widget => widget.name === "body_angles")) {
                buildReferenceManager(this);
                return result;
            }
            const widget = this.widgets?.find(widget => widget.name === (this._vkViggleMultiple ? "angles" : "image"));
            if (widget) {
                const callback = widget.callback;
                widget.callback = (value) => {
                    callback?.call(widget, value);
                    this._vkRenderAngleTabs?.();
                    showSelection(this);
                    if (this._vkViggleMultiple) document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:this}));
                };
                widget.hidden = true;
                widget.type = "hidden";
                widget.options = { ...widget.options, hidden: true };
                widget.computeSize = () => [0, -4];
            }
            buildPanel(this);
            installFileHandlers(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            requestAnimationFrame(() => {
                this._vkReferenceManager?.restore();
                this._vkRenderAngleTabs?.(); showSelection(this);
                if (this._vkViggleMultiple) document.dispatchEvent(new CustomEvent("vk-viggle-angles-changed", {detail:this}));
            });
            return result;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._vkReferenceManager?.dispose();
            this._vkViggleLoadImage?.closeGallery?.();
            return onRemoved?.apply(this, arguments);
        };

    },
});
