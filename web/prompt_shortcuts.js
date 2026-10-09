const storageKey = "vk-viggle-prompt-shortcuts";
const readShortcuts = () => JSON.parse(localStorage.getItem(storageKey) || '{"head":[],"body":[]}');

export function newShortcutText(text, shortcuts) {
    const split = value => value.split(/[,\r\n]+/).map(part=>part.trim()).filter(Boolean);
    const normalize = value => value.replace(/\s+/g," ").toLowerCase();
    const parts = split(text), normalized = parts.map(normalize);
    const known = shortcuts.map(item=>split(item.text).map(normalize)).filter(parts=>parts.length).sort((a,b)=>b.length-a.length);
    const remaining = [], added = new Set();
    for (let index = 0; index < parts.length;) {
        const match = known.find(sequence=>sequence.every((part,offset)=>part===normalized[index + offset]));
        if (match) index += match.length;
        else {
            if (!added.has(normalized[index])) {remaining.push(parts[index]); added.add(normalized[index]);}
            index++;
        }
    }
    return remaining.join(", ");
}

export function buildPromptShortcuts(node, intervalButton) {
    const button = document.createElement("button"); button.className = "prompt-shortcuts-button";
    button.textContent = "Prompt shortcuts...";
    button.title = "Manage shared Head and Body prompt shortcuts. Add, edit, delete and reorder them.";
    const popup = document.createElement("section"); popup.className = "prompt-shortcuts-manager";
    popup.setAttribute("popover", "auto"); popup.setAttribute("role", "dialog"); popup.setAttribute("aria-label", "Prompt shortcuts");
    popup.innerHTML = '<header><strong>Prompt shortcuts</strong><button type="button" aria-label="Close prompt shortcuts">×</button></header><p>Shared by all characters and videos. Use […] beside Additional prompt to select shortcuts, or + to save only text not already in saved shortcuts.</p><div class="prompt-shortcuts-tabs" role="tablist" aria-label="Shortcut type"><button type="button" role="tab" data-role="head">Head</button><button type="button" role="tab" data-role="body">Body</button></div>';
    intervalButton.after(button, popup);
    popup.querySelector("header button").onclick = () => popup.hidePopover();
    const fields = {}, selected = {head:new Set(), body:new Set()};
    let activeRole = "head";
    const save = shortcuts => localStorage.setItem(storageKey, JSON.stringify(shortcuts));
    function renderManager() {
        popup.querySelectorAll('[role="tab"]').forEach(tab=>tab.setAttribute("aria-selected",String(tab.dataset.role===activeRole)));
        popup.querySelectorAll(".prompt-shortcuts-category").forEach(section => section.remove());
        const shortcuts = readShortcuts();
        for (const role of ["head", "body"]) {
            const section = document.createElement("section"); section.className = "prompt-shortcuts-category";
            section.dataset.role = role;
            section.hidden = role !== activeRole; section.setAttribute("role","tabpanel");
            const title = role === "head" ? "Head" : "Body";
            shortcuts[role].forEach((item, index) => {
                const row = document.createElement("div"); row.className = "prompt-shortcut-row";
                const input = document.createElement("input"); input.type = "text"; input.value = item.text;
                input.setAttribute("aria-label", `${title} shortcut ${index + 1}`);
                input.title = "Edit this prompt shortcut. Changes are saved locally.";
                input.oninput = () => { const value = readShortcuts(); value[role].find(entry => entry.id === item.id).text = input.value; save(value); };
                row.append(input);
                for (const [label, delta] of [["Move up", -1], ["Move down", 1], ["Delete", 0]]) {
                    const action = document.createElement("button"); action.type = "button";
                    action.textContent = delta < 0 ? "↑" : delta > 0 ? "↓" : "×";
                    action.setAttribute("aria-label", `${label} ${title.toLowerCase()} shortcut ${index + 1}`); action.title = action.getAttribute("aria-label");
                    action.disabled = delta < 0 && index === 0 || delta > 0 && index === shortcuts[role].length - 1;
                    action.onclick = () => {
                        const value = readShortcuts(), entries = value[role], position = entries.findIndex(entry => entry.id === item.id);
                        if (delta) [entries[position], entries[position + delta]] = [entries[position + delta], entries[position]];
                        else entries.splice(position, 1);
                        save(value); renderManager();
                    };
                    row.append(action);
                }
                section.append(row);
            });
            const add = document.createElement("button"); add.type = "button"; add.textContent = `+ Add ${title} shortcut`;
            add.title = `Create a reusable ${title.toLowerCase()} prompt snippet.`;
            add.onclick = () => {
                const value = readShortcuts(); value[role].push({id:crypto.randomUUID(), text:""}); save(value);
                renderManager(); popup.querySelector(`[data-role="${role}"] .prompt-shortcut-row:last-of-type input`).focus();
            };
            section.append(add); popup.append(section);
        }
    }
    for (const tab of popup.querySelectorAll('[role="tab"]')) tab.onclick = () => {activeRole = tab.dataset.role; renderManager();};
    button.onclick = () => { renderManager(); popup.togglePopover(); };
    function attach(role, group) {
        const title = role === "head" ? "Head" : "Body";
        const label = document.createElement("label"); label.className = "guide-new-prompt";
        const input = document.createElement("input"); input.type = "text";
        input.setAttribute("aria-label", `${title} additional prompt for new guides`);
        input.title = `Append this text on a new line after the ${title.toLowerCase()} default prompt when adding guides. Kept until you change or clear it.`;
        label.append("Add additional prompt to new guide : ", input); fields[role] = input;
        const storeField = () => {
            (node.properties.vkViggleNewGuidePrompts ||= {})[role] = input.value;
            node.graph?.setDirtyCanvas(true,true);
        };
        input.oninput = () => { selected[role].clear(); storeField(); };
        const choose = document.createElement("button"); choose.type = "button"; choose.textContent = "…";
        choose.className = "guide-prompt-shortcuts"; choose.setAttribute("aria-label", `${title} prompt shortcuts`);
        choose.title = `Select one or several ${title.toLowerCase()} prompt shortcuts in your saved order.`;
        const list = document.createElement("section"); list.className = "prompt-shortcuts-picker";
        list.setAttribute("popover", "auto"); list.setAttribute("role", "dialog"); list.setAttribute("aria-label", `${title} prompt shortcuts`);
        choose.onclick = () => {
            list.replaceChildren();
            const entries = readShortcuts()[role].filter(item => item.text.trim());
            const heading = document.createElement("strong"); heading.textContent = `${title} prompt shortcuts`; list.append(heading);
            if (!entries.length) {const empty = document.createElement("p"); empty.textContent = "No shortcuts. Add some in Prompt shortcuts..."; list.append(empty);}
            for (const item of entries) {
                const option = document.createElement("label"), checkbox = document.createElement("input"); checkbox.type = "checkbox";
                checkbox.title = "Include this shortcut. Multiple selections are allowed.";
                checkbox.checked = selected[role].has(item.id);
                checkbox.onchange = () => {
                    if (checkbox.checked) selected[role].add(item.id); else selected[role].delete(item.id);
                    input.value = entries.filter(entry => selected[role].has(entry.id)).map(entry => entry.text).join(", ");
                    storeField();
                };
                option.append(checkbox, item.text); list.append(option);
            }
            const done = document.createElement("button"); done.type = "button"; done.textContent = "Done";
            done.title = "Close this list and keep the selected prompts in the field.";
            done.onclick = () => list.hidePopover(); list.append(done); list.togglePopover();
        };
        const add = document.createElement("button"); add.type = "button"; add.textContent = "+";
        add.className = "guide-prompt-save"; add.setAttribute("aria-label", `Save ${title.toLowerCase()} additional prompt as shortcut`);
        add.title = `Save only new text as a ${title.toLowerCase()} shortcut. Existing comma-separated or multiline snippets are ignored, regardless of case or extra spaces. The prompt field is kept.`;
        add.onclick = () => {
            const value = readShortcuts(), text = newShortcutText(input.value,value[role]);
            if (!text) return;
            value[role].push({id:crypto.randomUUID(),text}); save(value);
        };
        const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "↺";
        reset.className = "guide-prompt-reset"; reset.setAttribute("aria-label", `Clear ${title.toLowerCase()} additional prompt`);
        reset.title = "Clear this additional prompt. Shared defaults and existing guides are kept.";
        reset.onclick = () => {input.value = ""; selected[role].clear(); storeField();};
        group.append(label, choose, add, reset, list);
    }
    return {attach, value:role => fields[role].value,
        restore() {for (const role of ["head", "body"]) {fields[role].value = node.properties.vkViggleNewGuidePrompts?.[role] || ""; selected[role].clear();}},
        dispose() {popup.remove();},
    };
}
