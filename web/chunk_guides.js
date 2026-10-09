import { buildGuideEditor, resolvedGuide, MODE_NAMES, GUIDE_DEFAULTS } from "./guide_editor.js";
import { api } from "../../../scripts/api.js";
import { buildPromptShortcuts } from "./prompt_shortcuts.js";

function angleImageUrl(image) {
    const normalized = image.replace(/\\/g,"/"), separator = normalized.lastIndexOf("/");
    const query = new URLSearchParams({filename:normalized.slice(separator + 1),type:"input",preview:"webp;90",channel:"rgb"});
    if (separator >= 0) query.set("subfolder", normalized.slice(0,separator));
    return api.apiURL(`/view?${query}`);
}

function promptChanges(defaultPrompt, prompt) {
    const before = defaultPrompt.match(/\S+/g) || [], after = prompt.match(/\S+/g) || [];
    const lengths = Array.from({length:before.length + 1},()=>new Uint32Array(after.length + 1));
    for (let i = before.length - 1; i >= 0; i--) {
        for (let j = after.length - 1; j >= 0; j--) lengths[i][j] = before[i] === after[j] ? 1 + lengths[i + 1][j + 1] : Math.max(lengths[i + 1][j],lengths[i][j + 1]);
    }
    const changes = [];
    let i = 0, j = 0, group;
    while (i < before.length || j < after.length) {
        if (i < before.length && j < after.length && before[i] === after[j]) {i++; j++; group = null; continue;}
        const removed = i < before.length && (j === after.length || lengths[i + 1][j] >= lengths[i][j + 1]);
        const word = removed ? before[i++] : after[j++];
        if (group?.removed === removed) group.text += ` ${word}`;
        else {group = {removed,text:word}; changes.push(group);}
    }
    return changes;
}

function connectedReference(node, body = false) {
    const slot = node.inputs?.findIndex(input => input.name === (body ? "body_reference_angles" : "reference_angles"));
    if (slot == null || slot < 0) return null;
    let link = node.graph?.links?.[node.inputs[slot].link];
    let source = node.getInputNode(slot);
    const visited = new Set();
    while (source && !visited.has(source)) {
        visited.add(source);
        if (source.type !== "Reroute") return {source, body:link?.origin_slot === 2};
        link = source.graph?.links?.[source.inputs?.[0]?.link];
        source = source.getInputNode(0);
    }
    return null;
}

function connectedAngles(node, body = false, selectedOnly = false) {
    const reference = connectedReference(node, body);
    if (reference?.source._vkCharacterManager) return reference.source._vkCharacterManager.getAngles(reference.body, selectedOnly);
    const widget = reference?.source.widgets?.find(widget => widget.name === (reference.body ? "body_angles" : "angles"));
    return widget ? (selectedOnly ? null : JSON.parse(widget.value)) : [];
}

export function nearestGuideFrame(times, time) {
    let low = 0, high = times.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (times[middle] < time) low = middle + 1;
        else high = middle;
    }
    const right = Math.min(low, times.length - 1), left = Math.max(0, right - 1);
    return Math.abs(times[left] - time) <= Math.abs(times[right] - time) ? left : right;
}

export function buildChunkGuidesUI(node, root, context) {
    const widget = node.widgets.find(item => item.name === "guide_selection");
    widget.hidden = true;
    const panel = document.createElement("div");
    panel.className = "chunk-guides";
    panel.innerHTML = `<div class="controls chunk-navigation">
        <button class="chunk-prev" title="Inspect the previous chunk without changing cuts or generation order." disabled>‹</button>
        <span class="chunk-label">Chunk — / —</span>
        <button class="chunk-next" title="Inspect the next chunk without changing cuts or generation order." disabled>›</button></div>
        <div class="chunk-reference-status option-hint" role="status"></div>
        <section class="guide-gallery-panel"><h2>Guides (0)</h2>
        <div class="guide-gallery"></div>
        <div class="controls guide-pagination"><button class="guide-page-prev" aria-label="Previous guide page" title="Show the previous six guides.">‹</button><span class="guide-page-label" aria-live="polite"></span><button class="guide-page-next" aria-label="Next guide page" title="Show the next six guides.">›</button></div>
        <div class="controls guide-pickers"><label>Reference angle (head) <div class="guide-angle guide-angle-buttons" role="group" aria-label="Head reference angle"></div></label>
        <label>Reference angle (body) <div class="guide-body-angle guide-angle-buttons" role="group" aria-label="Body reference angle"></div></label></div>
        <div class="controls guide-actions"><button class="guide-add" data-swap-mode="head" disabled title="Add the displayed frame with a head swap.">+Add Head swapped guide</button>
        <button class="guide-add-body" data-swap-mode="body" disabled title="Add the displayed frame with a full-body swap.">+Add Body swapped guide</button>
        <button class="guide-add-both" data-swap-mode="both" disabled title="Add the displayed frame with two passes: full body, then head.">+Add Body then Head swapped guide</button>
        <button class="guide-replace" disabled title="Move the selected guide to the displayed frame. Keep its swap settings and reference assignment.">Replace selected</button>
        <button class="guide-chunk-ref" disabled title="Make the selected guide this chunk's reference, preserving its swap settings.">Chunk Ref</button>
        <button class="guide-remove" disabled title="Remove the selected guide or reference, including overlapping chunks.">Remove selected</button>
        <button class="guide-remove-chunk" disabled title="Remove ordinary guides in the inspected chunk, including shared guides. Keep all reference images.">Remove Chunk Guides</button><button class="guide-remove-video" disabled title="Remove all ordinary guides for this video, including outside the cut. Keep all reference images.">Remove All Guides</button><button class="guide-remove-everything" disabled title="Remove all guides and reference images for this video, including outside the cut.">Remove All Guides and Reference Images</button><button class="guide-save-video" disabled title="Replace this video's local save with all guides, including outside the cut, reference assignments and swap settings. No generation is needed.">Save All Guides</button></div>
        </section>
        <div class="guide-status" role="status"></div>`;
    root.insertBefore(panel, root.querySelector(".status"));
    const settings = root.querySelector(".guide-settings");
    settings.innerHTML = `<label>Interval guide mode <select class="guide-new-mode" aria-label="Interval guide swap mode">${Object.entries(MODE_NAMES).map(([id,label])=>`<option value="${id}">${label}</option>`).join("")}</select></label><label title="Add guides across the whole loaded video on a new video load. Saved guides take priority. Uncheck to choose guides manually."><input class="guide-auto-load" type="checkbox"> Automatically add guides at interval</label>
        <label title="Spacing in loaded frames across the whole video. 0 disables automatic guides; start with 5 frames.">Every <input class="guide-auto-frames" type="number" min="0" step="1" value="0" aria-label="Automatic guide interval in frames"> frames</label>
        <div class="option-hint">Whole loaded video · 0 = manual · minimum 5 frames</div>
        <div class="controls"><button class="guide-auto" disabled title="Add missing guides every chosen number of frames across the whole loaded video. Existing guides and angles are kept.">Add interval guides now</button></div>
        <label title="Replace this video's local save with all guides, reference assignments and swap settings on run. Loading the video restores the last save. Off keeps the previous save; Save All Guides saves without running."><input class="guide-auto-save" type="checkbox"> Automatically save guides on run</label>`;

    const addBar = document.createElement("div"); addBar.className = "guide-add-bar";
    addBar.append(...panel.querySelectorAll("[data-swap-mode]"));
    const intervalButton = document.createElement("button"); intervalButton.className = "guide-interval-button";
    intervalButton.textContent = "Auto interval guides...";
    intervalButton.title = "Configure guide spacing, swap mode and automatic additions.";
    const intervalPopup = document.createElement("div"); intervalPopup.className = "guide-interval-popup";
    intervalPopup.setAttribute("popover","auto"); intervalPopup.setAttribute("role","dialog"); intervalPopup.setAttribute("aria-label","Auto interval guides");
    intervalPopup.innerHTML = '<header><strong>Auto interval guides</strong><button type="button" aria-label="Close interval settings">×</button></header>';
    intervalPopup.append(...[...settings.children].filter(child=>!child.querySelector(".guide-auto-save")));
    intervalButton.onclick = () => intervalPopup.togglePopover();
    intervalPopup.querySelector("header button").onclick = () => intervalPopup.hidePopover();
    addBar.append(intervalButton,intervalPopup);
    const promptShortcuts = buildPromptShortcuts(node, intervalButton);
    const activeCharacter = document.createElement("figure"); activeCharacter.className = "guide-add-character";
    const characterImage = document.createElement("img"), characterEmpty = document.createElement("span"), characterName = document.createElement("figcaption");
    characterEmpty.textContent = "Front empty";
    activeCharacter.append(characterImage,characterEmpty,characterName);
    const anglePreview = document.createElement("div"); anglePreview.className = "guide-angle-preview";
    anglePreview.setAttribute("popover","manual"); anglePreview.setAttribute("role","tooltip");
    const anglePreviewImage = document.createElement("img"), anglePreviewName = document.createElement("div");
    anglePreview.append(anglePreviewImage,anglePreviewName); addBar.append(anglePreview);
    function previewAngle(button,angle) {
        const show = () => {
            anglePreviewImage.src = angleImageUrl(angle.image); anglePreviewImage.alt = angle.name;
            anglePreviewName.textContent = angle.name;
            anglePreview.showPopover();
            const bounds = button.getBoundingClientRect(), size = anglePreview.getBoundingClientRect();
            anglePreview.style.left = `${Math.max(8,Math.min(bounds.left + (bounds.width - size.width) / 2,window.innerWidth - size.width - 8))}px`;
            anglePreview.style.top = `${bounds.bottom + size.height + 8 <= window.innerHeight ? bounds.bottom + 6 : Math.max(8,bounds.top - size.height - 6)}px`;
        };
        button.onpointerenter = button.onfocus = show;
        button.onpointerleave = button.onblur = button.onpointerdown = () => anglePreview.hidePopover();
    }
    const angleControls = document.createElement("div"); angleControls.className = "guide-new-controls"; addBar.append(angleControls);
    const angleRow = document.createElement("div"); angleRow.className = "guide-new-angles";
    const referenceToggle = document.createElement("button"); referenceToggle.className = "guide-reference-toggle";
    referenceToggle.textContent = "Chunk Ref Frame ? NO";
    referenceToggle.title = "When YES, the next Head / Body / Body then Head guide replaces this chunk’s reference, using the selected angles and prompt shortcuts, then returns to NO. A muted NO means this chunk already has a reference.";
    referenceToggle.onclick = () => {
        node.properties.vkViggleNewGuideIsReference = !node.properties.vkViggleNewGuideIsReference;
        node.graph?.setDirtyCanvas(true,true); render();
    };
    angleControls.append(angleRow,referenceToggle,activeCharacter);
    const referenceWarning = document.createElement("div"); referenceWarning.className = "guide-reference-warning";
    referenceWarning.setAttribute("role","alert"); referenceWarning.hidden = true;
    referenceWarning.textContent = "/!\\ Warning : at least one or your reference frame has a body swap and at least another one is a head only swap. This will not look good !";
    addBar.append(referenceWarning);
    for (const role of ["head","body"]) {
        const group = document.createElement("div"); group.className = "guide-new-angle-group";
        const label = document.createElement("span"); label.textContent = `${role === "head" ? "Head" : "Body"} angle`;
        const picker = document.createElement("div"); picker.className = `guide-new-${role}-angle guide-angle-buttons`;
        picker.setAttribute("role","group"); picker.setAttribute("aria-label", `New guide ${role} angle`);
        picker.title = "Choose an image angle for new guides. This selection stays unchanged after adding a guide.";
        picker.onclick = event => {
            const button = event.target.closest("button[data-angle-id]"); if (!button) return;
            node.properties.vkViggleNewGuideAngles ||= {};
            node.properties.vkViggleNewGuideAngles[picker.dataset.selectionKey] = button.dataset.angleId;
            node.graph?.setDirtyCanvas(true,true);
            render();
        };
        group.append(label,picker); angleRow.append(group);
        promptShortcuts.attach(role, group);
    }
    const addButtons = document.createElement("div"); addButtons.className = "guide-add-buttons";
    addButtons.append(...[...addBar.children].filter(child=>child.tagName === "BUTTON" && child !== referenceToggle));
    addBar.prepend(addButtons);
    root.querySelector(".loader-timeline").after(addBar);
    const get = selector => panel.querySelector(selector) || addBar.querySelector(selector) || settings.querySelector(selector) || root.querySelector(selector);
    const band = document.createElement("div");
    band.className = "chunk-range"; band.hidden = true;
    root.querySelector(".track").append(band);
    const markers = document.createElement("span"), timeline = document.createElement("span");
    markers.className = "guide-markers"; timeline.className = "guide-timeline-markers";
    root.querySelector(".quick-markers").append(markers);
    root.querySelector(".track").append(timeline);
    let chunk = Number(node.properties.vkViggleInspectedChunk) || 0, selected = null;
    let page = 0, pageChunk = chunk;
    let controller, urls = [], galleryKey = "", version = 0;
    const defaultsWidget = node.widgets.find(item => item.name === "prompt_defaults");
    defaultsWidget.hidden = true;
    node.widgets.find(item => item.name === "reference_settings").hidden = true;
    const preferenceKey = "vk-viggle-prompt-defaults";
    defaultsWidget.value = localStorage.getItem(preferenceKey) || defaultsWidget.value || JSON.stringify(JSON.parse(widget.value || "{}").defaults || {});
    const config = () => ({...JSON.parse(widget.value || "{}"), defaults:JSON.parse(defaultsWidget.value || "{}")});
    get(".guide-new-mode").onchange = () => {
        const value = config(); value.default_mode = get(".guide-new-mode").value;
        widget.value = JSON.stringify(value); node.graph?.setDirtyCanvas(true,true);
    };
    const guideWorkspace = document.createElement("div"); guideWorkspace.className = "guide-workspace";
    panel.before(guideWorkspace); guideWorkspace.append(panel);
    const guideEditor = buildGuideEditor(node,root,config,() => mapped().find(([frame]) => frame === selected), (value, redraw, rebaseAngles = false) => {
        if (rebaseAngles) rebaseGuideAngles(value, mapped().find(([frame]) => frame === selected)[1]);
        widget.value = JSON.stringify(value); node.graph?.setDirtyCanvas(true,true);
        defaultsWidget.value = JSON.stringify(value.defaults || {});
        localStorage.setItem(preferenceKey,defaultsWidget.value);
        document.dispatchEvent(new CustomEvent("vk-viggle-defaults-changed", {detail:{node,value:defaultsWidget.value}}));
        if (redraw) render(); else updateGuideLabels();
    });
    guideWorkspace.append(guideEditor.element);
    const saveOptions = document.createElement("div"); saveOptions.className = "guide-save-options";
    saveOptions.append(settings.querySelector(".guide-auto-save").closest("label"));
    guideWorkspace.append(saveOptions); settings.hidden = true;
    guideEditor.element.insertBefore(get(".guide-pickers"),guideEditor.element.querySelector(".guide-editor-fields"));
    const autoLoad = get(".guide-auto-load"), autoFrames = get(".guide-auto-frames");
    intervalPopup.insertBefore(autoFrames.closest("label"),autoLoad.closest("label"));
    const autoSave = node.widgets.find(item => item.name === "auto_save_guides");
    autoSave.hidden = true;
    get(".guide-auto-save").onchange = () => {
        autoSave.value = get(".guide-auto-save").checked;
        node.graph?.setDirtyCanvas(true,true);
    };
    function restoreAutoSettings() {
        promptShortcuts.restore();
        if (localStorage.getItem(preferenceKey)) defaultsWidget.value = localStorage.getItem(preferenceKey);
        else if (!defaultsWidget.value || defaultsWidget.value === "{}") defaultsWidget.value = JSON.stringify(JSON.parse(widget.value || "{}").defaults || {});
        get(".guide-auto-save").checked = Boolean(autoSave.value);
        autoLoad.checked = node.properties.vkViggleAutoGuides ?? false;
        autoFrames.value = node.properties.vkViggleAutoGuideFrames ?? 0;
    }
    autoLoad.onchange = () => {
        if (autoLoad.checked && Number(autoFrames.value) === 0) autoFrames.value = 5;
        node.properties.vkViggleAutoGuides = autoLoad.checked;
        node.properties.vkViggleAutoGuideFrames = Number(autoFrames.value);
        node.graph?.setDirtyCanvas(true, true);
    };
    autoFrames.onchange = () => {
        const value = Math.round(Number(autoFrames.value)) || 0;
        autoFrames.value = value === 0 ? 0 : Math.max(5, value);
        if (Number(autoFrames.value) === 0) autoLoad.checked = false;
        autoLoad.onchange();
    };
    restoreAutoSettings();
    const assignments = (body = false) => {
        const value = JSON.parse(widget.value || "{}");
        return value.video === context.video() ? value[body ? "body_angles" : "angles"] || {} : {};
    };
    const angleId = (frame, body = false) => {
        const pair = mapped().find(([index]) => index === frame);
        return pair ? assignments(body)[String(pair[1])] : null;
    };
    const angleName = frame => {
        const time = mapped().find(([index]) => index === frame)?.[1], mode = resolvedGuide(config(),time).swap_mode;
        return (mode === "both" ? [true,false] : [mode === "body"]).flatMap(body => {
            const id = angleId(frame,body);
            if (!id) return [];
            const tab = connectedAngles(node,body).find(tab => tab.id === id);
            return [tab ? tab.name.replace(`${tab.character_name} · `, "") : "Missing angle"];
        }).join(" + ");
    };
    function updateGuideLabel(frame,label) {
        const value = config(), time = mapped().find(([index]) => index === frame)?.[1];
        const item = resolvedGuide(value,time), owner = referenceOwner(frame,time);
        const getAngle = body => connectedAngles(node,body).find(angle => angle.id === angleId(frame,body));
        label.closest(".guide-thumb")?.setAttribute("data-reference",String(Boolean(owner)));
        const defaults = {...GUIDE_DEFAULTS[item.swap_mode], ...value.defaults?.[item.swap_mode]};
        label.textContent = `${owner ? `★ Reference · chunk ${owner}\n` : ""}${MODE_NAMES[item.swap_mode]}\nFrame ${frame + 1}\n${(context.start() + context.times()[frame]).toFixed(3)} s`;
        const reference = referenceForChunk();
        const character = getAngle(item.swap_mode === "body")?.character_name;
        if (character) label.textContent = label.textContent.replace("\n", `\n${character}\n`);
        if (reference?.[0] === frame && owner !== chunk + 1) {
            const warning = document.createElement("span"); warning.className = "guide-borrowed-reference-warning";
            warning.textContent = `\nDefault reference from chunk ${owner} - please select a reference frame from this chunk if possible`;
            label.append(warning);
        }
        for (const [key,name] of [["body_prompt","Body"],["head_prompt","Head"],["sam_prompt","SAM3"]]) {
            if (owner && key === "sam_prompt") continue;
            if (key === "head_prompt" && item.swap_mode === "body" || key === "body_prompt" && item.swap_mode === "head") continue;
            const changes = promptChanges(defaults[key],item[key]);
            if (!changes.length) continue;
            const custom = document.createElement("span"); custom.className = "guide-customized";
            custom.textContent = `\n${name}: `; custom.style.color = "#ff6b6b";
            for (const [index,change] of changes.entries()) {
                if (index) custom.append(" ");
                const text = document.createElement(change.removed ? "del" : "span"); text.textContent = change.text;
                custom.append(text);
            }
            label.append(custom);
        }
        const references = label.parentElement.querySelector(".guide-thumb-references");
        references.replaceChildren();
        for (const body of item.swap_mode === "both" ? [true,false] : [item.swap_mode === "body"]) {
            const angle = getAngle(body);
            if (!angle?.image) continue;
            const image = document.createElement("img"); image.src = angleImageUrl(angle.image);
            image.alt = `${body ? "Body" : "Head"}: ${angle.name}`; image.title = image.alt;
            const reference = document.createElement("span"); reference.className = "guide-thumb-angle";
            const name = document.createElement("span");
            name.textContent = angle.name.replace(`${angle.character_name} · `, "");
            reference.title = image.alt;
            reference.append(image,name); references.append(reference);
        }
    }
    function updateGuideLabels() {
        for (const button of get(".guide-gallery").querySelectorAll(".guide-thumb")) updateGuideLabel(Number(button.dataset.frame),button.querySelector(".guide-thumb-label"));
    }
    const selection = () => {
        const value = JSON.parse(widget.value || "{}");
        return value.video === context.video() ? value.times || [] : [];
    };
    const mapped = () => {
        const times = context.times(), start = context.start();
        if (!times.length) return [];
        const frames = new Map();
        for (const time of selection()) {
            if (time < start - 0.000001 || time >= start + context.duration() - 0.000001) continue;
            const frame = nearestGuideFrame(times, time - start);
            if (!frames.has(frame)) frames.set(frame, time);
        }
        return [...frames].sort((a,b) => a[0] - b[0]);
    };
    function referenceOwner(frame,time) {
        const assigned = config().settings?.[String(time)]?.reference_chunk;
        const span = context.spans()[assigned - 1];
        return span && frame >= span.first && frame <= span.last ? assigned : null;
    }
    function referenceForChunk() {
        return mapped().filter(([frame,time]) => referenceOwner(frame,time)).sort((a,b) => {
            const left = config().settings[String(a[1])].reference_chunk;
            const right = config().settings[String(b[1])].reference_chunk;
            return Math.abs(left - chunk - 1) - Math.abs(right - chunk - 1) || left - right;
        })[0];
    }
    function framesForChunk() {
        const span = context.spans()[chunk];
        if (!span) return [];
        const frames = mapped().map(([frame]) => frame).filter(frame => frame >= span.first && frame <= span.last);
        const reference = referenceForChunk();
        if (reference && !frames.includes(reference[0])) frames.push(reference[0]);
        return frames.sort((a,b)=>a-b);
    }
    function save(times, angles = assignments(), bodyAngles = assignments(true), settings = config().video === context.video() ? config().settings || {} : {}) {
        const before = selection(), value = config();
        times = [...new Set(times)].sort((a,b) => a-b);
        angles = Object.fromEntries(times.filter(time => angles[String(time)]).map(time => [String(time), angles[String(time)]]));
        bodyAngles = Object.fromEntries(times.filter(time => bodyAngles[String(time)]).map(time => [String(time), bodyAngles[String(time)]]));
        settings = Object.fromEntries(times.map(time => [String(time), settings[String(time)] || {swap_mode:before.includes(time) ? "head" : value.default_mode || "head"}]));
        widget.value = JSON.stringify({...value, video:context.video(), times, angles, body_angles:bodyAngles, settings});
        node.graph?.setDirtyCanvas(true, true);
        render();
        context.guidesChanged?.();
    }
    function clearImages() {
        controller?.abort(); ++version;
        urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
        get(".guide-gallery").replaceChildren();
        galleryKey = "";
    }
    async function gallery(frames) {
        const key = `${chunk}:${context.endpoint("thumbnails", {})}:${frames.map(frame => `${frame}:${angleName(frame)}`).join(",")}`;
        if (key === galleryKey) {
            updateGuideLabels();
            get(".guide-gallery").querySelectorAll(".guide-thumb").forEach(button => button.setAttribute("aria-pressed",String(Number(button.dataset.frame) === selected)));
            return;
        }
        clearImages(); galleryKey = key;
        if (!context.ready()) return;
        if (!frames.length) return;
        controller = new AbortController(); const signal = controller.signal, current = version;
        try {
            for (let offset = 0; offset < frames.length; offset += 12) {
                const batch = frames.slice(offset, offset + 12);
                const response = await context.fetch(context.endpoint("thumbnails", {frames:batch.map(frame => frame + 1).join(",")} ), {signal,cache:"no-store"});
                if (!response.ok) throw new Error("Cannot load guide thumbnails.");
                const blob = await response.blob();
                if (current !== version) return;
                const url = URL.createObjectURL(blob); urls.push(url);
                batch.forEach((frame,index) => {
                    const button = document.createElement("button"); button.type = "button";
                    button.className = "guide-thumb"; button.dataset.frame = frame;
                    button.setAttribute("aria-pressed",String(frame === selected));
                    const time = (context.start() + context.times()[frame]).toFixed(3);
                    button.title = `Seek to loaded frame ${frame + 1} at ${time} s in the source video; select the guide to edit its swap and reference settings.`;
                    const image = document.createElement("span"); image.className = "guide-thumb-image";
                    image.style.backgroundImage = `url("${url}")`;
                    image.style.backgroundSize = `${batch.length * 100}% 100%`;
                    image.style.backgroundPosition = `${batch.length > 1 ? index * 100 / (batch.length - 1) : 0}% 0`;
                    const label = document.createElement("span"); label.className = "guide-thumb-label";
                    const caption = document.createElement("span"); caption.className = "guide-thumb-caption";
                    const references = document.createElement("span"); references.className = "guide-thumb-references";
                    caption.append(label,references);
                    button.append(image,caption);
                    updateGuideLabel(frame,label);
                    button.onclick = () => {
                        selected = frame; guideEditor.selectGuide();
                        get(".guide-angle").value = angleId(frame) || "";
                        get(".guide-body-angle").value = angleId(frame, true) || "";
                        context.seek(frame + 1); render();
                    };
                    get(".guide-gallery").append(button);
                });
            }
        } catch(error) { if (error.name !== "AbortError") get(".guide-status").textContent = error.message; }
    }
    function updateTimeline() {
        const span = context.spans()[chunk];
        if (span) {
            const left = context.fraction(span.first + 1), right = context.fraction(span.last + 1);
            band.style.left = `${left * 100}%`; band.style.width = `${Math.max(0,right-left) * 100}%`;
        }
        for (const cursor of timeline.children) cursor.style.left = `${context.fraction(Number(cursor.dataset.frame)) * 100}%`;
    }
    function render(updateEditor = true) {
        anglePreview.hidePopover();
        const head = connectedAngles(node,false,true) ?? connectedAngles(node), body = connectedAngles(node,true,true) ?? connectedAngles(node,true);
        const manager = connectedReference(node)?.source._vkCharacterManager || connectedReference(node,true)?.source._vkCharacterManager;
        const character = manager?.getSelectedCharacter();
        characterName.textContent = character?.name || head[0]?.character_name || body[0]?.character_name || "—";
        characterImage.hidden = !character?.image; characterEmpty.hidden = Boolean(character?.image);
        if (character?.image) {
            const url = angleImageUrl(character.image);
            if (characterImage.getAttribute("src") !== url) characterImage.src = url;
            characterImage.alt = `${character.name} · front`;
        } else characterImage.removeAttribute("src");
        activeCharacter.title = "Adding guides or changing a guide's angle or swap mode uses this selected character.";
        for (const [role,angles] of [["head",head],["body",body]]) {
            const picker = get(`.guide-new-${role}-angle`), available = angles.filter(angle=>angle.image);
            const key = `${role}:${angles[0]?.character_id || "connected"}`;
            const remembered = node.properties.vkViggleNewGuideAngles?.[key];
            const chosen = available.find(angle=>angle.id===remembered) || available.find(angle=>angle.name.trim().toLowerCase()==="front") || available[0];
            picker.replaceChildren(); picker.dataset.selectionKey = key;
            for (const angle of available) {
                const button = document.createElement("button"); button.type = "button"; button.dataset.angleId = angle.id;
                button.textContent = angle.name; button.setAttribute("aria-pressed",String(angle.id===chosen?.id));
                button.title = `Use ${angle.name} for new ${role} guides.`; picker.append(button);
                previewAngle(button,angle);
            }
            if (!chosen) picker.textContent = "No angle available";
            picker.value = chosen?.id || "";
            if (chosen) {node.properties.vkViggleNewGuideAngles ||= {}; node.properties.vkViggleNewGuideAngles[key] = chosen.id;}
        }
        get(".guide-new-mode").value = config().default_mode || "head";
        for (const body of [false, true]) {
            const picker = get(body ? ".guide-body-angle" : ".guide-angle"), tabs = connectedAngles(node, body);
            const current = picker.value;
            const id = selected == null ? current : angleId(selected, body);
            const available = (connectedAngles(node,body,true) ?? tabs).filter(angle=>angle.image);
            picker.replaceChildren(); picker.value = id || "";
            for (const angle of available) {
                const button = document.createElement("button"); button.type = "button"; button.dataset.angleId = angle.id;
                button.textContent = angle.name.split(" · ").at(-1); button.title = `Use ${angle.name} from the selected character for this guide.`;
                button.setAttribute("aria-pressed",String(angle.id===id)); picker.append(button);
                previewAngle(button,angle);
            }
            if (!available.length) picker.textContent = "No angle available";
        }
        markers.replaceChildren(); timeline.replaceChildren();
        const spans = context.spans();
        chunk = Math.max(0,Math.min(chunk,spans.length - 1));
        const span = spans[chunk], ready = context.ready() && Boolean(span);
        get(".select").disabled = !canSelectReference();
        const creatingReference = Boolean(node.properties.vkViggleNewGuideIsReference);
        referenceToggle.textContent = `Chunk Ref Frame ? ${creatingReference ? "YES" : "NO"}`;
        referenceToggle.setAttribute("aria-pressed",String(creatingReference));
        referenceToggle.dataset.hasReference = String(Boolean(localReference()));
        const value = config();
        const modes = new Set(selection().filter(time=>value.settings?.[String(time)]?.reference_chunk).map(time=>resolvedGuide(value,time).swap_mode));
        referenceWarning.hidden = !(modes.has("head") && (modes.has("body") || modes.has("both")));
        referenceToggle.disabled = !ready;
        get(".guide-chunk-ref").disabled = true;
        band.hidden = !ready;
        get(".chunk-prev").disabled = !ready || chunk === 0;
        get(".chunk-next").disabled = !ready || chunk === spans.length - 1;
        get(".chunk-label").textContent = span ? `Chunk ${chunk + 1} / ${spans.length} · frames ${span.first + 1}–${span.last + 1}` : "Chunk — / —";
        for (const name of ["guide-add","guide-add-body","guide-add-both","guide-auto","guide-remove-chunk","guide-remove-video","guide-remove-everything","guide-save-video"]) get(`.${name}`).disabled = !ready;
        for (const button of addBar.querySelectorAll("[data-swap-mode]")) {
            const mode = button.dataset.swapMode;
            button.disabled ||= mode !== "body" && head.length > 0 && !get(".guide-new-head-angle").value || mode !== "head" && body.length > 0 && !get(".guide-new-body-angle").value;
        }
        if (!ready) { clearImages(); get(".guide-page-label").textContent = "0 guides"; get(".guide-page-prev").disabled = get(".guide-page-next").disabled = true; if (updateEditor) guideEditor.render(); context.layoutMarkers(); return; }
        const allFrames = mapped().map(([frame]) => frame);
        for (const frame of allFrames) {
            const time = mapped().find(([index])=>index === frame)[1];
            const owner = referenceOwner(frame,time);
            const title = `${owner ? `Reference for chunk ${owner}` : angleName(frame) || "Guide"} · loaded frame ${frame + 1} · ${(context.start() + context.times()[frame]).toFixed(3)} s in source video`;
            const cursor = document.createElement("div");
            cursor.className = owner ? "marker reference-timeline-marker" : "marker guide-timeline-marker";
            cursor.title = title; cursor.dataset.frame = frame + 1;
            cursor.style.left = `${context.fraction(frame + 1) * 100}%`;
            timeline.append(cursor);
            const marker = document.createElement("button");
            marker.type = "button"; marker.className = owner ? "quick-symbol reference-symbol" : "quick-symbol guide-symbol";
            marker.title = title; marker.setAttribute("aria-label",title); marker.dataset.frame = frame + 1;
            marker.onclick = event => { event.stopPropagation(); context.seek(frame + 1); };
            markers.append(marker);
        }
        updateTimeline();
        context.layoutMarkers();
        const reference = referenceForChunk();
        const assigned = reference ? config().settings[String(reference[1])].reference_chunk : null;
        get(".chunk-reference-status").classList.toggle("guide-borrowed-reference-warning",Boolean(reference && assigned !== chunk + 1));
        get(".chunk-reference-status").textContent = reference ?
            (assigned === chunk + 1 ? `Reference: frame ${reference[0] + 1} · selected for this chunk` :
                `Default reference from chunk ${assigned} - please select a reference frame from this chunk if possible`) :
            "No chunk reference selected · using Windowed Conditioning reference.";
        const frames = framesForChunk();
        if (chunk !== pageChunk) {page = 0; pageChunk = chunk;}
        page = Math.max(0,Math.min(page,Math.ceil(frames.length / 6) - 1));
        get(".guide-page-prev").disabled = page === 0;
        get(".guide-page-next").disabled = (page + 1) * 6 >= frames.length;
        get(".guide-page-label").textContent = frames.length ? `${page * 6 + 1}–${Math.min(frames.length,(page + 1) * 6)} / ${frames.length} · Page ${page + 1}/${Math.ceil(frames.length / 6)}` : "0 guides";
        get("h2").textContent = `Guides (${frames.length})`;
        const selectedTime = mapped().find(([frame])=>frame === selected)?.[1];
        const selectedOwner = referenceOwner(selected,selectedTime);
        get(".guide-replace").disabled = !frames.includes(selected) || Boolean(selectedOwner && selectedOwner !== chunk + 1);
        get(".guide-remove").disabled = !frames.includes(selected);
        get(".guide-chunk-ref").disabled = !ready || !frames.includes(selected) || Boolean(selectedOwner) || selected < span.first || selected > span.last;
        gallery(frames.slice(page * 6,(page + 1) * 6));
        if (updateEditor) guideEditor.render();
    }
    for (const [name,delta] of [["guide-page-prev",-1],["guide-page-next",1]]) get(`.${name}`).onclick = () => {
        page += delta;
        const frames = framesForChunk();
        selected = frames[page * 6] ?? null;
        guideEditor.selectGuide(); render();
    };
    function inspectFrame(frame) {
        const index = context.spans().findLastIndex(span => frame >= span.first + 1 && frame <= span.last + 1);
        if (index < 0 || index === chunk) return;
        chunk = index; selected = null; node.properties.vkViggleInspectedChunk = chunk;
        render();
        node.graph?.setDirtyCanvas(true,true);
    }
    function rebaseGuideAngles(value, time) {
        for (const body of [false,true]) {
            const key = body ? "body_angles" : "angles", angles = connectedAngles(node,body,true) ?? connectedAngles(node,body);
            const available = angles.filter(angle=>angle.image);
            const assignments = value[key] ||= {};
            const chosen = available.find(angle=>angle.id===assignments[String(time)]) || available.find(angle=>angle.id===get(body ? ".guide-new-body-angle" : ".guide-new-head-angle").value);
            if (chosen) assignments[String(time)] = chosen.id;
            else delete assignments[String(time)];
        }
    }
    for (const body of [false, true]) {
        get(body ? ".guide-body-angle" : ".guide-angle").onclick = event => {
            const button = event.target.closest("button[data-angle-id]"); if (!button) return;
            get(body ? ".guide-body-angle" : ".guide-angle").value = button.dataset.angleId;
            if (selected == null) return;
            const pair = mapped().find(([frame]) => frame === selected);
            if (!pair) return;
            const value = config(); rebaseGuideAngles(value,pair[1]);
            value[body ? "body_angles" : "angles"][String(pair[1])] = button.dataset.angleId;
            save(selection(), value.angles, value.body_angles);
        };
    }
    const defaultsChanged = event => {
        if (event.detail.node === node) return;
        defaultsWidget.value = event.detail.value; guideEditor.render(); updateGuideLabels(); node.graph?.setDirtyCanvas(true,true);
    };
    document.addEventListener("vk-viggle-defaults-changed",defaultsChanged);
    const anglesChanged = () => render();
    document.addEventListener("vk-viggle-angles-changed", anglesChanged);
    function newGuideSettings(mode) {
        const settings = {swap_mode:mode};
        const defaults = {...GUIDE_DEFAULTS[mode], ...config().defaults?.[mode]};
        for (const role of mode === "both" ? ["head", "body"] : [mode]) {
            const extra = promptShortcuts.value(role).trim();
            if (extra) settings[`${role}_prompt`] = [defaults[`${role}_prompt`], extra].filter(Boolean).join("\n");
        }
        return settings;
    }
    function localReference() {
        return mapped().find(([frame,time])=>referenceOwner(frame,time) === chunk + 1);
    }
    function canSelectReference() {
        return Boolean(context.ready() && localReference());
    }
    function assignReference(settings,time) {
        for (const item of Object.values(settings)) {
            if (item.reference_chunk === chunk + 1) delete item.reference_chunk;
        }
        settings[String(time)] = {...settings[String(time)], reference_chunk:chunk + 1};
    }
    get(".select").onclick = () => {
        if (canSelectReference()) context.seek(localReference()[0] + 1);
    };
    get(".guide-chunk-ref").onclick = () => {
        if (get(".guide-chunk-ref").disabled) return;
        const time = mapped().find(([frame])=>frame === selected)[1];
        const settings = structuredClone(config().settings || {});
        assignReference(settings,time);
        get(".guide-status").textContent = `Reference for chunk ${chunk + 1} selected at loaded frame ${selected + 1}.`;
        save(selection(),assignments(),assignments(true),settings);
        guideEditor.selectGuide();
    };
    for (const [name,delta] of [["chunk-prev",-1],["chunk-next",1]]) get(`.${name}`).onclick = () => {
        chunk += delta; selected = null; node.properties.vkViggleInspectedChunk = chunk;
        context.seek(context.spans()[chunk].first + 1); render();
        node.graph?.setDirtyCanvas(true,true);
    };
    for (const name of ["guide-add","guide-add-body","guide-add-both","guide-replace","guide-remove"]) get(`.${name}`).onclick = () => {
        const adding = name.startsWith("guide-add");
        const frame = context.frame()-1, span = context.spans()[chunk];
        if (name !== "guide-remove" && (frame < span.first || frame > span.last)) {
            get(".guide-status").textContent = "Seek inside the inspected chunk's blue range first."; return;
        }
        const existingTime = mapped().find(([index])=>index === frame)?.[1];
        const existingOwner = referenceOwner(frame,existingTime);
        if (adding && node.properties.vkViggleNewGuideIsReference && existingOwner && existingOwner !== chunk + 1) return;
        const chosenAngle = adding ? get(".guide-new-head-angle").value : get(".guide-angle").value;
        const chosenBody = adding ? get(".guide-new-body-angle").value : get(".guide-body-angle").value;
        const previous = mapped().find(([index]) => index === selected)?.[1];
        if (name === "guide-replace" && referenceOwner(selected,previous) && referenceOwner(selected,previous) !== chunk + 1) return;
        const mode = name === "guide-replace" && previous != null ? resolvedGuide(config(),previous).swap_mode : get(`.${name}`).dataset.swapMode || "head";
        if (name !== "guide-remove" && (mode !== "body" && connectedAngles(node).length && !chosenAngle || mode !== "head" && connectedAngles(node, true).length && !chosenBody)) {
            get(".guide-status").textContent = "Choose head and body reference angles first."; return;
        }
        const remove = adding ? null : selected;
        const excluded = new Set(selection().filter(time => time >= context.start() - 0.000001 &&
            time < context.start() + context.duration() - 0.000001 &&
            nearestGuideFrame(context.times(),time-context.start()) === remove));
        let times = selection().filter(time => !excluded.has(time));
        const angles = {...assignments()}, bodyAngles = {...assignments(true)};
        const settings = structuredClone(config().settings || {});
        if (name !== "guide-remove") {
            const time = context.start()+context.times()[frame];
            times.push(time); selected=frame; angles[String(time)] = chosenAngle; bodyAngles[String(time)] = chosenBody;
            settings[String(time)] = name === "guide-replace" ? settings[String(previous)] || {swap_mode:"head"} : {...settings[String(time)],...newGuideSettings(mode)};
            if (adding && node.properties.vkViggleNewGuideIsReference) {
                assignReference(settings,time);
                node.properties.vkViggleNewGuideIsReference = false;
            }
        }
        else selected=null;
        get(".guide-status").textContent = name === "guide-remove" ? "Guide removed." : `Guide saved at loaded frame ${frame+1}.`;
        if (name !== "guide-remove") {
            const pageFrames = [...new Set(times.filter(time => time >= context.start() && time < context.start()+context.duration()).map(time => nearestGuideFrame(context.times(),time-context.start())))].filter(frame => frame >= span.first && frame <= span.last).sort((a,b)=>a-b);
            page = Math.floor(pageFrames.indexOf(frame) / 6); pageChunk = chunk;
            guideEditor.selectGuide();
        }
        save(times, angles, bodyAngles, settings);
    };
    get(".guide-remove-chunk").onclick = () => {
        const span = context.spans()[chunk];
        const times = selection().filter(time => !(time >= context.start() - 0.000001 &&
            time < context.start() + context.duration() - 0.000001 &&
            nearestGuideFrame(context.times(), time - context.start()) >= span.first &&
            nearestGuideFrame(context.times(), time - context.start()) <= span.last &&
            !config().settings?.[String(time)]?.reference_chunk));
        selected = null;
        get(".guide-status").textContent = "Chunk guides removed; reference images kept."; save(times);
    };
    get(".guide-remove-video").onclick = () => {
        selected = null;
        get(".guide-status").textContent = "All video guides removed; reference images kept.";
        save(selection().filter(time=>config().settings?.[String(time)]?.reference_chunk));
    };
    get(".guide-remove-everything").onclick = () => {
        selected = null;
        const value = config(); delete value.reference;
        widget.value = JSON.stringify(value);
        get(".guide-status").textContent = "All video guides and reference images removed."; save([]);
    };
    get(".guide-save-video").onclick = async () => {
        const button = get(".guide-save-video"), value = config();
        value.video = context.video();
        button.disabled = true;
        get(".guide-status").textContent = "Saving all guides and chunk references...";
        try {
            const response = await api.fetchApi("/vk-viggle/video/guides", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:context.video(),config:value})});
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Cannot save guides.");
            get(".guide-status").textContent = "All guides and chunk references saved; previous save replaced.";
        } catch (error) { get(".guide-status").textContent = error.message; }
        finally { button.disabled = !context.ready(); }
    };
    get(".guide-auto").onclick = () => {
        const chosenAngle = get(".guide-new-head-angle").value;
        const chosenBody = get(".guide-new-body-angle").value, mode = config().default_mode || "head";
        if (mode !== "body" && connectedAngles(node).length && !chosenAngle || mode !== "head" && connectedAngles(node, true).length && !chosenBody) {
            get(".guide-status").textContent = "Choose head and body reference angles first."; return;
        }
        const interval = Math.round(Number(autoFrames.value));
        if (!Number.isFinite(interval) || interval <= 0) {get(".guide-status").textContent="Enter a positive interval in frames.";return;}
        const times = context.times(), step = Math.max(5,interval);
        const frames = new Set(mapped().map(([frame])=>frame)), additions=[];
        for (let frame=0;frame<times.length;frame+=step) {
            if (!frames.has(frame)) additions.push(context.start()+times[frame]);
        }
        get(".guide-status").textContent=`${additions.length} guides added; existing choices kept.`;
        const addedSettings = newGuideSettings(mode);
        save([...selection(),...additions], {...assignments(), ...Object.fromEntries(additions.map(time => [String(time), chosenAngle]))},
            {...assignments(true), ...Object.fromEntries(additions.map(time => [String(time), chosenBody]))},
            {...config().settings, ...Object.fromEntries(additions.map(time => [String(time), addedSettings]))});
    };
    function onVideoLoaded() {
        const saved = JSON.parse(widget.value || "{}");
        if (saved.video === context.video() && saved.reference && context.times().length) {
            const time = saved.reference.time, item = saved.reference.settings || {};
            const frame = nearestGuideFrame(context.times(),time-context.start());
            const assigned = context.spans().findLastIndex(span=>frame >= span.first && frame <= span.last) + 1;
            if (time >= context.start() && time < context.start()+context.duration() && assigned) {
                saved.times = [...new Set([...(saved.times || []),time])].sort((a,b)=>a-b);
                saved.settings ||= {}; saved.settings[String(time)] = {...item, reference_chunk:assigned};
                for (const [key,field] of [["angles","angle_id"],["body_angles","body_angle_id"]]) {
                    saved[key] ||= {}; if (item[field]) saved[key][String(time)] = item[field];
                }
                delete saved.reference;
                widget.value = JSON.stringify(saved); node.graph?.setDirtyCanvas(true,true);
            }
        }
        if (saved.video === context.video()) return;
        selected = null;
        render();
        const interval = Number(autoFrames.value);
        if (!autoLoad.checked || interval === 0) { save([]); get(".guide-status").textContent = "Add guides manually."; return; }
        const step = Math.max(5, Math.round(interval));
        const times = context.times(), chosen = get(".guide-new-head-angle").value, chosenBody = get(".guide-new-body-angle").value;
        const additions = [];
        for (let frame = 0; frame < times.length; frame += step) additions.push(context.start() + times[frame]);
        const addedSettings = newGuideSettings(config().default_mode || "head");
        save(additions, Object.fromEntries(additions.map(time => [String(time), chosen])),
            Object.fromEntries(additions.map(time => [String(time), chosenBody])),
            Object.fromEntries(additions.map(time => [String(time), addedSettings])));
        get(".guide-status").textContent = `${additions.length} guides added every ${step} loaded frames.`;
    }
    return {render, updateTimeline, inspectFrame, onVideoLoaded, restoreAutoSettings, canSelectReference, dispose(){document.removeEventListener("vk-viggle-angles-changed", anglesChanged);document.removeEventListener("vk-viggle-defaults-changed", defaultsChanged);clearImages();guideEditor.dispose();promptShortcuts.dispose();guideWorkspace.remove();addBar.remove();panel.remove();band.remove();markers.remove();timeline.remove();}};
}
