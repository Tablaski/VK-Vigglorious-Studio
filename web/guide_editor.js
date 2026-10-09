export const GUIDE_DEFAULTS = {
    head:{sam_prompt:"head, hair", head_prompt:"", body_prompt:"", mask_mode:"sam3"},
    both:{sam_prompt:"person", head_prompt:"", body_prompt:"", mask_mode:"sam3"},
    body:{sam_prompt:"person", head_prompt:"", body_prompt:"", mask_mode:"sam3"},
};
export const MODE_NAMES = {head:"Head", body:"Body", both:"Body then Head"};

export function resolvedGuide(config, time) {
    const item = config.settings?.[String(time)] || {}, mode = item.swap_mode || "head";
    return {swap_mode:mode, ...GUIDE_DEFAULTS[mode], ...config.defaults?.[mode], ...item};
}

export function buildGuideEditor(node, root, configuration, selection, commit) {
    const panel = document.createElement("section"); panel.className = "guide-editor";
    panel.innerHTML = '<div class="controls editor-tabs"><button data-tab="guide">Selected guide settings</button><button data-tab="defaults">Default guide settings</button></div><div class="guide-editor-fields"></div>';
    (root.querySelector(".loader-sidebar") || root).append(panel);
    let tab = "guide";
    const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    function renderFields(fields, isDefault, pair, defaultMode) {
        const config = configuration(), time = pair?.[1];
        const overrides = config.settings?.[String(time)] || {};
        const item = isDefault ? {swap_mode:defaultMode, ...GUIDE_DEFAULTS[defaultMode], ...config.defaults?.[defaultMode]} : resolvedGuide({...config,settings:{[time]:overrides}},time);
        const mode = item.swap_mode, roles = mode === "both" ? ["head","body"] : [mode];
        const maskToggle = `<label class="guide-mask-toggle"><input type="checkbox" role="switch" data-field="mask_mode" aria-label="Generate guide mask" ${item.mask_mode === "sam3" ? "checked" : ""}><span>Generate guide mask</span><strong>${item.mask_mode === "sam3" ? "ON" : "OFF"}</strong></label>`;
        const promptField = (key,label) => {
            const custom = Object.hasOwn(overrides,key), id = `vk-${node.id}-${isDefault ? defaultMode : "guide"}-${key}`;
            return `<div class="guide-prompt"><div class="controls"><label for="${id}">${label}</label>${isDefault ? (key === "sam_prompt" ? maskToggle : "") : `<button data-reset-prompt="${key}" ${custom ? "" : "disabled"} title="Return to the shared default prompt for this mode.">Use default</button>`}</div><textarea id="${id}" data-field="${key}" rows="3" aria-label="${label}">${escape(item[key])}</textarea><div class="option-hint">${isDefault ? "Shared default for all characters and videos." : custom ? "Custom for this frame." : "Inherited default. Type to customize this frame."}</div></div>`;
        };
        const referenceChunk = Number(overrides.reference_chunk) || 0;
        fields.innerHTML = `<div class="guide-editor-header"><strong>${isDefault ? MODE_NAMES[defaultMode] : `Guide · frame ${pair[0] + 1} · ${time.toFixed(3)} s`}</strong>
            ${isDefault ? "" : `<label>Swap mode<select data-field="swap_mode" aria-label="Guide swap mode" title="Changing mode uses the selected character. Existing angles for that character are kept.">${Object.entries(MODE_NAMES).map(([key,label])=>`<option value="${key}" ${key===mode ? "selected" : ""}>${label}</option>`).join("")}</select></label>`}</div>
            <div class="guide-prompts" style="--guide-columns:${roles.length + (referenceChunk ? 0 : 1)}">
            ${roles.map(role=>`<div class="guide-role-column" data-guide-role="${role}">${isDefault ? "" : '<div class="guide-angle-slot"></div>'}${promptField(`${role}_prompt`,role === "head" ? "Qwen head additional prompt" : "Qwen body additional prompt")}</div>`).join("")}
            ${referenceChunk ? '<div class="option-hint">Native image reference; guide attention strength and SAM3 masks do not apply.</div>' : `<div class="guide-mask-settings">${isDefault ? "" : maskToggle}${promptField("sam_prompt","SAM3 prompt")}<div class="option-hint">${item.mask_mode === "none" ? "Mask generation is off; the prompt is kept for later." : "SAM3 segments the swapped guide."}</div></div>`}</div>`;
    }
    function render() {
        const pair = selection(), fields = panel.querySelector(".guide-editor-fields");
        panel.querySelectorAll("[data-tab]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.tab===tab)));
        const pickers = panel.querySelector(".guide-pickers");
        const angleLabels = [...panel.querySelectorAll(".guide-angle,.guide-body-angle")].map(picker=>picker.closest("label"));
        if (pickers) {pickers.hidden=true; pickers.append(...angleLabels);}
        if (tab === "defaults") {
            fields.innerHTML = '<div class="option-hint">Shared by all characters and videos, separately for each swap type.</div><div class="guide-defaults"></div>';
            for (const mode of Object.keys(MODE_NAMES)) {
                const card = document.createElement("section"); card.className="guide-default-card"; card.dataset.defaultMode=mode;
                renderFields(card,true,null,mode); fields.querySelector(".guide-defaults").append(card);
            }
        } else if (!pair) fields.innerHTML = '<div class="option-hint">Add a guide or select its thumbnail to edit it.</div>';
        else {
            renderFields(fields,false,pair);
            for (const label of angleLabels) {
                const role = label.querySelector(".guide-body-angle") ? "body" : "head";
                fields.querySelector(`[data-guide-role="${role}"] .guide-angle-slot`)?.append(label);
            }
        }
    }
    function click(event) {
        const button = event.target.closest("button"); if (!button) return;
        if (button.dataset.tab) {tab = button.dataset.tab; render(); return;}
        const config = configuration(), pair = selection(); if (!pair || !button.dataset.resetPrompt) return;
        const item = ((config.settings ||= {})[String(pair[1])] ||= {swap_mode:"head"});
        delete item[button.dataset.resetPrompt];
        commit(config,true);
    }
    function edit(event) {
        const key = event.target.dataset.field, config = configuration(); if (!key) return;
        const value = key === "mask_mode" ? (event.target.checked ? "sam3" : "none") : event.target.value;
        const defaultMode = event.target.closest("[data-default-mode]")?.dataset.defaultMode;
        if (defaultMode) {
            config.defaults ||= {}; config.defaults[defaultMode] ||= {};
            config.defaults[defaultMode][key] = value;
        } else {
            const pair = selection(); if (!pair) return;
            config.settings ||= {}; config.settings[String(pair[1])] ||= {swap_mode:"head"};
            config.settings[String(pair[1])][key] = value;
        }
        const redraw = event.target.tagName !== "TEXTAREA";
        commit(config,redraw,!defaultMode && key === "swap_mode");
        if (!redraw && !defaultMode) {
            const prompt = event.target.closest(".guide-prompt");
            prompt.querySelector("button").disabled = false;
            prompt.querySelector(".option-hint").textContent = "Custom for this frame.";
        }
    }
    panel.addEventListener("click",click);
    panel.addEventListener("input",event=>{if(event.target.tagName==="TEXTAREA") edit(event);});
    panel.addEventListener("change",event=>{if(event.target.tagName==="SELECT" || event.target.type==="checkbox") edit(event);});
    return {render, element:panel, selectGuide(){tab="guide"; render();}, dispose(){panel.remove();}};
}
