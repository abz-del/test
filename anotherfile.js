
/***** GENERIC CLASSES ***********/

/***** Backend classes *********/

class BackendInterface {
  constructor(config = {}) {
    this.timeoutMs = config.timeoutMs || 30000; // ✅ Default timeout: 30s, can be configured
  }

  async _callE2fEnhance(endpoint, params, signal = null) {
    if (!params || typeof params !== "object") {
      console.error("❌ Invalid parameters for _callE2fEnhance:", params);
      return [];
    }

    try {
      if (signal?.aborted) {
        console.warn(`⚠️ Request aborted before execution: ${endpoint}`);
        return [];
      }

      const results = await e2fEnhance(endpoint, params);

      if (signal?.aborted) {
        console.warn(`⚠️ Request aborted after execution: ${endpoint}`);
        return [];
      }

      return results;
    } catch (error) {
      if (signal?.aborted) {
        console.warn(`⚠️ e2fEnhance request aborted: ${endpoint}`);
        return [];
      } else {
        console.error(`❌ e2fEnhance call (${endpoint}) failed:`, error);
        return [];
      }
    }
  }

  async _callLLMAndParse(prompt, key, configurations, signal = null) {
    for (let pass = 0; pass < 2; pass++) {
      for (const modelConfig of configurations) {
        try {
          if (signal?.aborted) {
            console.warn(`⚠️ LLM request aborted before execution: ${key}`);
            return [];
          }

          return await Promise.race([
            new Promise((resolve, reject) => {
              systemAnswer(
                { configuration: modelConfig, question: prompt },
                (rawResponse) => {
                  if (signal?.aborted) {
                    console.warn(
                      `⚠️ LLM request aborted after execution: ${key}`,
                    );
                    return resolve([]); // 🔹 Resolve empty on abort
                  }

                  try {
                    const parsed = this._parseJSONResponse(rawResponse, key);
                    resolve(parsed);
                  } catch (error) {
                    console.error(`❌ Failed to extract ${key}:`, error);
                    reject(error);
                  }
                },
              );
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("⏳ Timeout")), this.timeoutMs),
            ),
          ]);
        } catch (error) {
          if (signal?.aborted) {
            console.warn(`⚠️ LLM request aborted during attempt: ${key}`);
            return []; // ✅ NEW: Return immediately if aborted
          }
          console.warn(
            `⚠️ Retrying ${key} extraction with ${modelConfig} (Pass ${pass + 1}) - Reason: ${error.message}`,
          );
        }
      }
    }

    console.error(`❌ All model configurations failed for ${key}`);
    return [
      {
        error: `Backend error`,
        details: `All model configurations failed for ${key}`,
      },
    ];
  }

  _parseJSONResponse(response, key) {
    let parsedResponse;

    // ✅ Strip unwanted Markdown formatting if present
    if (typeof response === "string") {
      response = response.trim();
      if (response.startsWith("```json")) {
        response = response.slice(7); // Remove ```json
      }
      if (response.endsWith("```")) {
        response = response.slice(0, -3); // Remove ```
      }
    }

    try {
      parsedResponse = JSON.parse(response);
    } catch (error) {
      console.error(`❌ Failed to parse ${key}:`, error);
      console.error("❌ Raw response:", response);
      throw error;
    }

    if (!parsedResponse || !Array.isArray(parsedResponse[key])) {
      throw new Error(`Invalid or missing '${key}' key in response`);
    }

    return parsedResponse[key];
  }
}

class TextManager {
  constructor() {
    if (!window.textManager) {
      this.texts = {}; // Stores translations per language
      this.currentLanguage = "en_US"; // Default language
      window.textManager = this;
    }
    return window.textManager;
  }

  /**
   * Add or overwrite multiple translations for multiple languages at once.
   * @param {Object} translations - Object with language keys and their translations
   */
  addTexts(translations) {
    for (const [language, texts] of Object.entries(translations)) {
      if (!this.texts[language]) {
        this.texts[language] = {};
      }
      for (const [key, value] of Object.entries(texts)) {
        this.texts[language][key] = value;
      }
    }
  }

  /**
   * Set the current language
   * @param {string} language - Language code
   */
  setLanguage(language) {
    if (this.texts[language]) {
      this.currentLanguage = language;
    } else {
      console.warn(
        `⚠️ Language '${language}' not found. Falling back to 'en_US'.`,
      );
      this.currentLanguage = "en_US";
    }
  }

  /**
   * Retrieve a text by ID, with fallback to English if missing
   * @param {string} textId - The unique ID of the text
   * @returns {string} - The translated text or a missing indicator
   */
  getText(textId) {
    return (
      (this.texts[this.currentLanguage] &&
        this.texts[this.currentLanguage][textId]) ||
      (this.texts["en_US"] && this.texts["en_US"][textId]) ||
      `[Missing: ${textId}]`
    );
  }
}
// ✅ Ensure a global instance is always available
window.textManager = new TextManager();

/***** UI Classes *********/

class HelperManager {
  constructor(containerId, styles = {}) {
    this.styles = {
      iconSize: "16px",
      iconColor: "#fff",
      iconBgColor: "#0066cc",
      tooltipBgColor: "#222",
      tooltipTextColor: "#f0f0f0",
      ...styles,
    };

    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(
        "❌ HelperManager Error: Container not found -",
        containerId,
      );
      return;
    }

    this.tooltipContainer = this.#createTooltipContainer();

    if (!this.tooltipContainer) {
      console.error(
        "❌ HelperManager Error: Failed to create tooltip container.",
      );
      return;
    }

    document.body.appendChild(this.tooltipContainer);
  }

  createHelpIcon(tooltipText) {
    const icon = document.createElement("span");
    icon.textContent = "?";
    icon.classList.add("help-icon");
    icon.style.cssText = `
      display: inline-flex;
      justify-content: center;
      align-items: center;
      width: ${this.styles.iconSize};
      height: ${this.styles.iconSize};
      font-size: ${this.styles.iconSize};
      font-weight: bold;
      color: ${this.styles.iconColor};
      background-color: ${this.styles.iconBgColor};
      border-radius: 50%;
      cursor: pointer;
      margin-left: 8px;
      transition: all 0.2s ease-in-out;
      position: relative;
    `;

    icon.addEventListener("mouseenter", () => {
      this.#applyHoverStyles(icon);
      this.#showTooltip(icon, tooltipText);
    });

    icon.addEventListener("mouseleave", () => {
      this.#restoreIconStyles(icon);
      this.#hideTooltip();
    });

    return icon;
  }

  #applyHoverStyles(icon) {
    icon.style.backgroundColor = this.styles.iconColor;
    icon.style.color = this.styles.iconBgColor;
  }

  #restoreIconStyles(icon) {
    icon.style.backgroundColor = this.styles.iconBgColor;
    icon.style.color = this.styles.iconColor;
  }

  #createTooltipContainer() {
    const tooltip = document.createElement("div");
    tooltip.style.cssText = `
      position: absolute;
      max-width: 250px;
      white-space: pre-wrap;
      background-color: #ADD8E6;
      color: #000000;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.15);
      z-index: 9999;
      display: none;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
    `;
    return tooltip;
  }

  #showTooltip(icon, text) {
    this.tooltipContainer.textContent = text;
    this.tooltipContainer.style.display = "block";
    this.tooltipContainer.style.opacity = "1";
    this.#updateTooltipPosition(icon);
  }

  #hideTooltip() {
    this.tooltipContainer.style.opacity = "0";
    setTimeout(() => {
      this.tooltipContainer.style.display = "none";
    }, 200);
  }

  #updateTooltipPosition(icon) {
    const iconRect = icon.getBoundingClientRect();
    const tooltipWidth = this.tooltipContainer.offsetWidth;
    const tooltipHeight = this.tooltipContainer.offsetHeight;
    const gap = 8; // Small spacing from the icon

    let left = iconRect.right + gap + window.scrollX;
    let top = iconRect.top + window.scrollY;

    // Adjust position if tooltip overflows the viewport
    if (window.innerWidth - iconRect.right < tooltipWidth) {
      left = iconRect.left - tooltipWidth - gap + window.scrollX;
    }
    if (window.innerHeight - iconRect.bottom < tooltipHeight) {
      top = iconRect.top - tooltipHeight - gap + window.scrollY;
    }

    this.tooltipContainer.style.left = `${left}px`;
    this.tooltipContainer.style.top = `${top}px`;
  }
}

class MultiPanelSplitter {
  constructor(container, panels, options = {}) {
    if (typeof container === "string") {
      this.container = document.getElementById(container);
    } else {
      this.container = container;
    }

    if (!this.container) {
      console.error("❌ ERROR: Container not found!");
      throw new Error("Container element is required.");
    }

    if (!Array.isArray(panels) || panels.length < 2) {
      console.error("❌ ERROR: Must provide at least two panels!");
      throw new Error("Invalid panel array.");
    }

    this.panels = panels;
    this.splitters = [];
    this.options = options;
    this.minWidth = options.minWidth || 50;
    this.isDragging = false;

    this.container.style.display = "flex";
    this.container.style.flexDirection = "row";
    this.container.style.position = "relative";
    this.container.style.overflow = "hidden";
    this.container.style.width = "100%";
    this.container.style.height = "100%";

    let panelWidth = Math.floor(100 / panels.length);
    this.panels.forEach((panel) => {
      panel.style.width = `${panelWidth}%`;
      panel.style.height = "100%";
      panel.style.overflowY = "auto";
      panel.style.flex = "none";
      this.container.appendChild(panel);
    });

    requestAnimationFrame(() => {
      this.#createSplitters();
      this.#attachResizeListener();
    });
  }

  /*** 🔒 PRIVATE: Creates the splitters ***/
  #createSplitters() {
    for (let i = 0; i < this.panels.length - 1; i++) {
      const splitter = document.createElement("div");
      splitter.classList.add("splitter-handle");
      splitter.style.width = "5px";
      splitter.style.height = "100%";
      splitter.style.background = "gray";
      splitter.style.cursor = "col-resize";
      splitter.style.position = "absolute";
      splitter.dataset.index = i;

      this.container.appendChild(splitter);
      this.splitters.push(splitter);
      this.attachDragHandlers(splitter, this.panels[i], this.panels[i + 1]);

      // ✅ Improved Hover & Drag Effects
      splitter.addEventListener("mouseenter", () => {
        if (!this.isDragging) {
          splitter.style.setProperty("background", "#444"); // ✅ Darker hover color
        }
      });

      splitter.addEventListener("mouseleave", () => {
        if (!this.isDragging) {
          splitter.style.setProperty("background", "gray");
        }
      });
    }

    this.#updateSplitters();
  }

  attachDragHandlers(splitter, leftPanel, rightPanel) {
    splitter.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.isDragging = true;
      splitter.style.setProperty("background", "#007bff"); // ✅ UI Button Blue

      const leftRect = leftPanel.getBoundingClientRect();
      const rightRect = rightPanel.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();

      this.dragState = {
        startX: event.clientX,
        leftPanel,
        rightPanel,
        leftStartWidth: leftRect.width,
        rightStartWidth: rightRect.width,
        totalWidth: leftRect.width + rightRect.width,
        containerWidth: containerRect.width,
        splitter,
        canDragLeft: true,
        canDragRight: true,
      };

      if (leftRect.width <= this.minWidth) {
        this.dragState.canDragLeft = false;
      }
      if (rightRect.width <= this.minWidth) {
        this.dragState.canDragRight = false;
      }

      document.addEventListener("mousemove", this.#handleDrag);
      document.addEventListener("mouseup", this.#stopDrag);
    });
  }

  #handleDrag = (event) => {
    if (!this.dragState) return;

    const delta = event.clientX - this.dragState.startX;
    let newLeftWidth = this.dragState.leftStartWidth + delta;
    let newRightWidth = this.dragState.rightStartWidth - delta;

    if (newLeftWidth < this.minWidth) {
      newLeftWidth = this.minWidth;
      this.dragState.canDragLeft = false;
    } else {
      this.dragState.canDragLeft = true;
    }

    if (newRightWidth < this.minWidth) {
      newRightWidth = this.minWidth;
      this.dragState.canDragRight = false;
    } else {
      this.dragState.canDragRight = true;
    }

    const totalPanelsWidth = this.panels.reduce(
      (sum, p) => sum + p.offsetWidth,
      0,
    );
    const totalSplittersWidth = this.splitters.reduce(
      (sum, s) => sum + s.offsetWidth,
      0,
    );
    const totalWidth = totalPanelsWidth + totalSplittersWidth;

    if (totalWidth > this.dragState.containerWidth) {
      const excess = totalWidth - this.dragState.containerWidth;
      newLeftWidth -= excess / 2;
      newRightWidth -= excess / 2;
    }

    if (delta < 0 && !this.dragState.canDragLeft) return;
    if (delta > 0 && !this.dragState.canDragRight) return;

    this.dragState.leftPanel.style.width = `${newLeftWidth}px`;
    this.dragState.rightPanel.style.width = `${newRightWidth}px`;

    this.#updateSplitters();
  };

  #stopDrag = () => {
    document.removeEventListener("mousemove", this.#handleDrag);
    document.removeEventListener("mouseup", this.#stopDrag);
    if (this.dragState) {
      this.dragState.splitter.style.setProperty("background", "gray");
    }
    this.isDragging = false;
    this.dragState = null;
  };

  #updateSplitters() {
    const workAreaRect = this.container.getBoundingClientRect();
    this.splitters.forEach((splitter, i) => {
      const panelRightEdge =
        this.panels[i].getBoundingClientRect().x + this.panels[i].offsetWidth;
      const adjustedLeft =
        panelRightEdge - workAreaRect.x - splitter.offsetWidth / 2;
      splitter.style.left = `${adjustedLeft}px`;
    });
  }

  #attachResizeListener() {
    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        this.#updateSplitters();
      });
    });
  }
}

class ToggleManager {
  constructor({
    container,
    toggleFields,
    helperManager,
    textManager,
    onUpdate,
    conditions,
    responseIndex = 0,
  }) {
    this.container = container;
    this.complete = false;
    this.toggleFields = toggleFields;
    this.toggles = this.#flattenFields(toggleFields);
    this.helperManager = helperManager;
    this.textManager = textManager;
    this.onUpdate = onUpdate;
    this.conditions = conditions;
    this.responseIndex = responseIndex;
    this.stopped = false;
    this._userAction = false;
    this.init();
  }

  #flattenFields(fields) {
    return fields
      .map((field) => {
        return {
          name: field.name ?? null,
          labelKey: field.labelKey ?? null, // ✅ propagate labelKey
          label: field.label,
          type: field.type,
          choices: field.choices || null,
          stop: field.stop || null,
          display: field.display || null,
          value: field.value ?? null,
          isStopExplanation: false,
          readOnly: field.readOnly ?? false,
          onHover: field.onHover || null,
          conditional: field.conditional || null,
          mandatory: field.mandatory ?? true,
          displayMultipleLines: field.displayMultipleLines ?? false,
        };
      })
      .flatMap((field) => {
        if (!field.stop?.explanation) return [field];

        const explanation = field.stop.explanation;

        if (!explanation.name) {
          explanation.name =
            (field.name ?? field.label ?? "field") + "_explanation"; // ✅ fallback if no parentField.name
        }

        return [
          field,
          {
            name: explanation.name ?? null,
            labelKey: explanation.labelKey ?? null,
            label: explanation.label ?? "Explanation",
            type: explanation.type || "Selection",
            choices: explanation.choices ?? [],
            display: explanation.display ?? null,
            value: explanation.value ?? null,
            isStopExplanation: true,
            parentLabel: field.label,
            readOnly: field.readOnly ?? false,
            onHover: null,
            conditional: null,
            mandatory: field.mandatory ?? true,
            displayMultipleLines:
              explanation.displayMultipleLines ??
              field.displayMultipleLines ??
              false,
          },
        ];
      });
  }

  #addHelp(targetElement, tooltipText) {
    if (!targetElement) {
      console.error("❌ Target element does not exist.");
      return;
    }
    const helpIcon = this.helperManager.createHelpIcon(tooltipText);
    targetElement.appendChild(helpIcon);
  }

  init() {
    this.layoutContainer = document.createElement("div");
    this.layoutContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
    this.container.appendChild(this.layoutContainer);
    this.#render(false);
  }

  isComplete() {
    return this.toggles.every((toggle) => {
      if (!toggle.mandatory) return true;
      if (toggle.conditional) {
        const allConditions = Array.isArray(toggle.conditional)
          ? toggle.conditional
          : [toggle.conditional];
        const passed = allConditions.every((cond) =>
          this.#evaluateCondition(cond),
        );
        if (!passed) return true;
      }
      if (toggle.isStopExplanation) {
        const parentToggle = this.toggles.find(
          (t) => t.label === toggle.parentLabel,
        );
        if (!parentToggle) return true;
        const stopTriggered =
          parentToggle.stop && parentToggle.value === parentToggle.stop.onValue;
        if (!stopTriggered) return true;
        return toggle.value !== null && toggle.value !== ""; // ✅ FIX: ensure explanation toggle is filled if parent stop triggered
      }
      if (Array.isArray(toggle.value)) {
        return toggle.value.length > 0;
      }
      return toggle.value !== null && toggle.value !== "";
    });
  }

  isStopped() {
    if (!this.stopped) return false;
    const stoppingToggle = this.toggles.find(
      (t) => t.stop && t.value === t.stop.onValue,
    );
    if (!stoppingToggle) return false;
    const explanationToggle = this.toggles.find(
      (t) => t.isStopExplanation && t.parentLabel === stoppingToggle.label,
    );
    if (!explanationToggle) return true;
    return explanationToggle.value !== null && explanationToggle.value !== ""; // ✅ FIX: only return true if explanation filled
  }

  #evaluateCondition(cond) {
    if (typeof cond === "string") {
      return !!this.conditions[cond];
    }

    if (typeof cond === "object") {
      if (cond.condition === "onIncorrectClaims") {
        return !!this.conditions["onIncorrectClaims"];
      }

      if (cond.condition === "onFieldValue") {
        const target = this.toggles.find(
          (t) => (t.name && t.name === cond.field) || t.label === cond.field,
        );
        return target && target.value === cond.value;
      }

      if (cond.condition === "onResponseIndex") {
        // ✅ FIX: evaluate using this.responseIndex
        const idxs = cond.responseIndex;
        return Array.isArray(idxs) && idxs.includes(this.responseIndex);
      }
    }

    return false;
  }

  #render(userAction = false) {
    this.layoutContainer.innerHTML = "";
    let isStopped = false;
    let stoppingToggle = null;

    this.toggles.forEach((toggle) => {
      if (isStopped) {
        if (
          !toggle.isStopExplanation ||
          toggle.parentLabel !== stoppingToggle.label
        ) {
          return;
        }
      } else {
        if (toggle.isStopExplanation) {
          return;
        }
      }

      if (toggle.conditional) {
        const allConditions = Array.isArray(toggle.conditional)
          ? toggle.conditional
          : [toggle.conditional];
        const passed = allConditions.every((cond) =>
          this.#evaluateCondition(cond),
        );
        if (!passed) return;
      }

      if (toggle.isStopExplanation) {
        const parentToggle = this.toggles.find(
          (t) => t.label === toggle.parentLabel,
        );
        if (
          !parentToggle ||
          parentToggle.value !== parentToggle?.stop?.onValue
        ) {
          return;
        }
      }

      const rowContainer = document.createElement("div");
      rowContainer.style.cssText = `
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 5px 10px;
				background-color: #f9f9f9;
				font-family: Arial, sans-serif;
				font-size: 14px;
			`;

      const labelContainer = document.createElement("div");
      labelContainer.style.display = "flex";
      labelContainer.style.alignItems = "center";
      rowContainer.appendChild(labelContainer);

      const label = document.createElement("span");
      label.textContent = toggle.label;
      label.style.cssText = `color: black; font-weight: bold;`;
      labelContainer.appendChild(label);

      if (toggle.onHover) {
        this.#addHelp(labelContainer, toggle.onHover);
      }

      const controlContainer = document.createElement("div");
      rowContainer.appendChild(controlContainer);
      this.layoutContainer.appendChild(rowContainer);
      toggle.rowContainer = rowContainer;

      if (toggle.type === "Yes/No") {
        this.#renderYesNoToggle(toggle, controlContainer);
      } else if (toggle.type === "Selection") {
        this.#renderSelectionToggle(toggle, controlContainer);
      } else if (toggle.type === "MultiSelection") {
        this.#renderMultiSelectionToggle(toggle, controlContainer);
      } else if (toggle.type === "Text") {
        this.#renderTextToggle(toggle, controlContainer);
      } else if (toggle.type === "Grade") {
        this.#renderGradeToggle(toggle, controlContainer);
      }

      if (toggle.value !== null && toggle.stop?.onValue === toggle.value) {
        isStopped = true;
        stoppingToggle = toggle;
      }
    });

    this.stopped = isStopped;

    if (this.onUpdate) {
      this.onUpdate(!!userAction);
    }
  }

  #renderYesNoToggle(toggle, controlContainer) {
    // NEW: Ensure the control container uses flex layout with proper alignment
    controlContainer.style.flexGrow = "1";
    controlContainer.style.minWidth = "0";
    controlContainer.style.display = "flex";
    controlContainer.style.justifyContent =
      toggle.alignment === "left" ? "flex-start" : "flex-end";

    const toggleButton = document.createElement("div");
    toggleButton.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center; /* Centers text within the toggle button */
      background: #d0d0d0;
      border-radius: 8px;
      padding: 2px;
      width: auto;
      height: 26px;
      position: relative;
      font-family: Arial, sans-serif;
      user-select: none;
      overflow: hidden;
      cursor: ${toggle.readOnly ? "default" : "pointer"};
    `;

    // Use display array if provided, otherwise default labels.
    const yesText = toggle.display ? toggle.display[0] : "Yes";
    const noText = toggle.display ? toggle.display[1] : "No";

    // Create an off-screen element to measure text width.
    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: nowrap;
      font-size: 12px;
      font-weight: bold;
      font-family: Arial, sans-serif;
    `;

    measureSpan.textContent = yesText;
    document.body.appendChild(measureSpan);
    const yesWidth = measureSpan.offsetWidth;

    measureSpan.textContent = noText;
    const noWidth = measureSpan.offsetWidth;
    document.body.removeChild(measureSpan);

    const textPadding = 10; // Space around text.
    const toggleWidth = yesWidth + noWidth + textPadding * 4;
    toggleButton.style.width = `${toggleWidth}px`;

    const toggleIndicator = document.createElement("div");
    toggleIndicator.style.cssText = `
      position: absolute;
      top: 2px;
      left: ${toggle.value === true ? "2px" : toggle.value === false ? `${toggleWidth / 2}px` : "2px"};
      width: ${toggleWidth / 2 - 4}px;
      height: 22px;
      background: ${toggle.value === null ? "transparent" : toggle.value === true ? "#28a745" : "#dc3545"};
      border-radius: 6px;
      transition: left 0.4s ease-in-out, background 0.4s ease-in-out;
      z-index: 0;
      opacity: 1 !important;
    `;

    // Create labels for Yes and No.
    const yesLabel = document.createElement("div");
    yesLabel.textContent = yesText;
    yesLabel.style.cssText = `
      font-size: 12px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      position: relative;
      z-index: 1;
      color: ${toggle.value === true ? "white" : "#666"};
      line-height: 22px;
      height: 22px;
      white-space: nowrap;
      padding: 0;
    `;

    const noLabel = document.createElement("div");
    noLabel.textContent = noText;
    noLabel.style.cssText = `
      font-size: 12px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      position: relative;
      z-index: 1;
      color: ${toggle.value === false ? "white" : "#666"};
      line-height: 22px;
      height: 22px;
      white-space: nowrap;
      padding: 0;
    `;

    const updateToggleState = () => {
      if (toggle.value === null) {
        toggleIndicator.style.background = "transparent";
        yesLabel.style.color = "#666";
        noLabel.style.color = "#666";
      } else {
        toggleIndicator.style.left =
          toggle.value === true ? "2px" : `${toggleWidth / 2}px`;
        toggleIndicator.style.background =
          toggle.value === true ? "#28a745" : "#dc3545";
        yesLabel.style.color = toggle.value === true ? "white" : "#666";
        noLabel.style.color = toggle.value === false ? "white" : "#666";
      }
      const correspondingField = this.toggleFields.find(
        (field) => field.label === toggle.label,
      );
      if (correspondingField) {
        correspondingField.value = toggle.value;
      }
    };

    const handleToggle = (selectedYes) => {
      if (toggle.readOnly) return;
      toggle.value = toggle.value === selectedYes ? null : selectedYes;
      updateToggleState();
      this.#render(true);
    };

    if (!toggle.readOnly) {
      yesLabel.addEventListener("click", () => handleToggle(true));
      noLabel.addEventListener("click", () => handleToggle(false));
    }

    toggleButton.appendChild(toggleIndicator);
    toggleButton.appendChild(yesLabel);
    toggleButton.appendChild(noLabel);
    controlContainer.appendChild(toggleButton);

    updateToggleState();
  }

  #renderSelectionToggle(toggle, controlContainer) {
    controlContainer.style.flexGrow = "1";
    controlContainer.style.minWidth = "0";
    controlContainer.style.display = "flex";
    controlContainer.style.justifyContent =
      toggle.alignment === "left" ? "flex-start" : "flex-end";
    const select = document.createElement("select");
    select.disabled = toggle.readOnly;
    select.style.cssText = `
      width: 150px;
      padding: 5px;
      font-size: 14px;
      font-family: Arial, sans-serif;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      opacity: ${toggle.readOnly ? "0.6" : "1"};
    `;
    toggle.choices.forEach((choice) => {
      const option = document.createElement("option");
      option.textContent = choice;
      option.value = choice;
      select.appendChild(option);
    });

    select.value = toggle.value ?? "";

    select.addEventListener("change", () => {
      toggle.value = select.value || null;
      this.#render(true);
    });

    controlContainer.appendChild(select);
  }

  #renderMultiSelectionToggle(toggle, controlContainer) {
    controlContainer.style.flexGrow = "1";
    controlContainer.style.minWidth = "0";
    controlContainer.style.display = "flex";
    controlContainer.style.flexWrap = toggle.displayMultipleLines
      ? "wrap"
      : "nowrap"; // ✅ Correct logic
    controlContainer.style.gap = "5px";
    controlContainer.style.justifyContent =
      toggle.alignment === "left" ? "flex-start" : "flex-end";

    toggle.choices.forEach((choice) => {
      const choiceButton = document.createElement("div");
      const isSelected =
        Array.isArray(toggle.value) && toggle.value.includes(choice);

      choiceButton.textContent = choice;
      choiceButton.style.cssText = `
				padding: 4px 10px;
				border-radius: 4px;
				background-color: ${isSelected ? "#007bff" : "#d0d0d0"};
				color: ${isSelected ? "white" : "black"};
				font-size: 14px;
				font-family: Arial, sans-serif;
				cursor: ${toggle.readOnly ? "default" : "pointer"};
				user-select: none;
				white-space: nowrap;
			`;

      if (!toggle.readOnly) {
        choiceButton.addEventListener("click", () => {
          if (!Array.isArray(toggle.value)) toggle.value = [];
          if (toggle.value.includes(choice)) {
            toggle.value = toggle.value.filter((val) => val !== choice);
          } else {
            toggle.value.push(choice);
          }
          this.#render(true);
        });
      }

      controlContainer.appendChild(choiceButton);
    });
  }

  #renderGradeToggle(toggle, controlContainer) {
    controlContainer.style.display = "flex";
    controlContainer.style.gap = "5px";
    controlContainer.style.justifyContent = "flex-end"; // Align like Yes/No toggle

    const scale = toggle.scale || 5; // Default to 5 if not set

    for (let i = 1; i <= scale; i++) {
      const gradeButton = document.createElement("div");
      gradeButton.textContent = i;
      gradeButton.style.cssText = `
				width: 26px;
				height: 26px;
				display: flex;
				align-items: center;
				justify-content: center;
				border-radius: 4px;
				background-color: ${toggle.value === i ? "#007bff" : "#d0d0d0"};
				color: ${toggle.value === i ? "white" : "black"};
				font-weight: bold;
				cursor: pointer;
				transition: background 0.3s ease;
			`;

      gradeButton.addEventListener("click", () => {
        if (toggle.readOnly) return;
        toggle.value = toggle.value === i ? null : i; // Clicking same value resets
        this.#render(true);
      });

      controlContainer.appendChild(gradeButton);
    }
  }

  #renderTextToggle(toggle, controlContainer) {
    // Let the control container stretch but use alignment based on toggle.alignment:
    controlContainer.style.flexGrow = "1";
    controlContainer.style.minWidth = "0";
    controlContainer.style.display = "flex";
    controlContainer.style.justifyContent =
      toggle.alignment === "left" ? "flex-start" : "flex-end";

    const input = document.createElement("input");
    input.type = "text";
    input.disabled = toggle.readOnly;
    input.style.cssText = `
      width: calc(100% - 10px);
      margin-left: 10px;
      padding: 5px;
      font-size: 14px;
      font-family: Arial, sans-serif; /* same as Evidences/Grounding */
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      opacity: ${toggle.readOnly ? "0.6" : "1"};
      box-sizing: border-box;
      text-align: left; /* keep text left-aligned inside the field */
    `;
    input.value = toggle.value || "";
    input.addEventListener("input", () => {
      toggle.value = input.value;
    });
    input.addEventListener("blur", () => {
      if (this.onUpdate) {
        this.onUpdate(true);
      }
    });
    controlContainer.appendChild(input);
  }

  setToggleValue(label, value) {
    const toggle = this.toggles.find((t) => t.label === label);
    if (toggle) {
      toggle.value = value;

      // ✅ Ensure ClaimsManager gets the new value
      const correspondingField = this.toggleFields.find(
        (field) => field.label === label,
      );
      if (correspondingField) {
        correspondingField.value = value;
      }

      this.#render(false);
    } else {
      console.warn(`⚠️ Toggle with label '${label}' not found`);
    }
  }

  getToggleFieldValues() {
    return this.toggles.map((toggle) => {
      const field = {
        label: toggle.label,
        value:
          toggle.type === "MultiSelection" && Array.isArray(toggle.value)
            ? [...toggle.value]
            : (toggle.value ?? null),
      };
      if (toggle.name) {
        field.name = toggle.name;
      }
      if (toggle.labelKey) {
        // ✅ propagate labelKey if exists
        field.labelKey = toggle.labelKey;
      }
      return field;
    });
  }

  setToggleFieldValues({ responseIndex, values, conditions = {} }) {
    try {
      if (typeof responseIndex === "number") {
        this.responseIndex = responseIndex;
      }

      this.conditions = conditions;

      if (!values || values.length === 0) {
        this.toggles.forEach((toggle) => {
          toggle.value = toggle.type === "Text" ? "" : null;
          if (toggle.stop && toggle.stop.explanation) {
            toggle.stop.explanation.value = null;
          }
        });
      } else {
        values.forEach((val) => {
          const toggle = this.toggles.find(
            (t) =>
              (val.name && t.name === val.name) ||
              (val.labelKey && t.labelKey === val.labelKey) ||
              t.label === val.label, // ✅ Match by name > labelKey > label
          );
          if (toggle) {
            toggle.value =
              toggle.type === "MultiSelection" && Array.isArray(val.value)
                ? [...val.value]
                : (val.value ?? (toggle.type === "Text" ? "" : null));
            if (toggle.stop && toggle.stop.explanation) {
              toggle.stop.explanation.value = val.explanation ?? null;
            }
          } else {
            console.warn(
              "[ToggleManager] ⚠️ No toggle found for field:",
              JSON.stringify(val, null, 2),
            );
          }
        });
      }

      this.#render(false);
    } catch (error) {
      console.error("❌ Error in setToggleFieldValues:", error);
    }
  }

  updateConditions(conditions) {
    // ✅ Prevent unnecessary re-renders
    const hasChanged = Object.keys(conditions).some(
      (key) => this.conditions[key] !== conditions[key],
    );

    if (hasChanged) {
      this.conditions = { ...conditions }; // ✅ Store the new conditions
      this.#render(false); // ✅ Refresh UI only if needed
    }
  }
}

class ClaimsBackend extends BackendInterface {
  //#region CONSTRUCTOR
  constructor(config = {}) {
    super(config);

    this.claimExtractionPrompt =
      config.claimExtractionPrompt ?? this.#defaultClaimExtractionPrompt();
    this.claimMatchingPrompt =
      config.claimMatchingPrompt ?? this.#defaultClaimMatchingPrompt();
    this.queryCreationPrompt =
      config.queryCreationPrompt ?? this.#defaultQueryCreationPrompt();

    this.claimExtractionConfig = Array.isArray(config.claimExtractionConfig)
      ? config.claimExtractionConfig
      : this.#defaultClaimExtractionConfig();

    this.claimMatchingConfig = Array.isArray(config.claimMatchingConfig)
      ? config.claimMatchingConfig
      : this.#defaultClaimMatchingConfig();

    this.queryCreationConfig = Array.isArray(config.queryCreationConfig)
      ? config.queryCreationConfig
      : this.#defaultQueryCreationConfig();
  }
  //#endregion
  //#region CLAIM EXTRACTION
  async extractClaims(response, signal = null) {
    if (!response || typeof response !== "string") {
      console.error("❌ extractClaims: Invalid response input");
      return [];
    }

    if (signal?.aborted) {
      console.warn("⚠️ extractClaims request aborted before execution.");
      return [];
    }

    const settings = this.#claimExtractionSettings();
    const formattedPrompt = settings.prompt.replace("${response}", response);

    const results = await this._callLLMAndParse(
      formattedPrompt,
      "claims",
      settings.configurations,
      signal,
    );
    if (signal?.aborted) {
      console.warn("⚠️ extractClaims request aborted after execution.");
      return [];
    }

    return results;
  }

  #claimExtractionSettings() {
    return {
      prompt: this.claimExtractionPrompt,
      configurations: this.claimExtractionConfig,
    };
  }

  #defaultClaimExtractionConfig() {
    return ["sonnet_3_5_v1_t_0_2", "gpt4o_t_0_2"];
  }

  #defaultClaimExtractionPrompt() {
    return `
			## Main description:
			Your task is to extract distinct, verifiable factual claims from the following input data.
			Return ONLY a plain JSON object with no additional formatting, markers, or explanations.
	
			### Input data:
			\${response}
	
			### Guidelines:
			- A claim is a statement of fact that can be proved or disproved with evidence
			- Claims MUST use EXACT, WORD-FOR-WORD segments from the text - NO modifications allowed
			- DO NOT add, remove, or change ANY words - extract exact verbatim text segments
			- Break down complex statements into more granular claims that can be individually verified
			- Separate location, time, and action elements into distinct claims when possible
			- Separate different attributes, characteristics, or statistics into individual claims
			- Claims should not overlap with each other
			- DO NOT include narrative framing or subjective commentary
			- DO NOT add any closing punctuations etc
			- Extract meaningful phrases that represent individual facts, even if they are incomplete sentences
			- DO NOT add ANY words to complete phrases or provide context
			- Avoid excessive overlapping content between claims
	
			### About "core" vs "non-core" claims:
			- A "core" claim captures the essential meaning, outcome, event, or fact that the text is mainly about.
			- A "non-core" claim provides additional details, context, background, or secondary information.
			- If the claim can stand alone and summarize a key idea of the text, it is likely core.
			- If the claim only supports, describes, or elaborates on a core idea, it is non-core.
			- You MUST assign "core": true or "core": false to every extracted claim.
	
			### EXAMPLE:
	
			Original text:
			"SpaceX successfully launched the Falcon Heavy rocket from Kennedy Space Center on March 15, 2023, carrying a classified military satellite into orbit. The mission, designated USSF-67, was the rocket's fifth flight overall and its second national security mission. The side boosters landed successfully at Landing Zones 1 and 2, while the center core was expended as planned. According to NASA officials, the launch was visible from as far as 500 miles away, and the mission was completed within the projected $90 million budget. Weather conditions were ideal with clear skies and minimal winds, though there had been concerns earlier in the day about potential delays."
	
			Good claims extraction:
			[
				{ "text": "SpaceX successfully launched the Falcon Heavy rocket", "core": true },
				{ "text": "from Kennedy Space Center on March 15, 2023", "core": false },
				{ "text": "carrying a classified military satellite into orbit", "core": true },
				{ "text": "The mission, designated USSF-67, was the rocket's fifth flight overall", "core": false },
				{ "text": "and its second national security mission", "core": false },
				{ "text": "The side boosters landed successfully at Landing Zones 1 and 2", "core": false },
				{ "text": "while the center core was expended as planned", "core": false },
				{ "text": "the launch was visible from as far as 500 miles away", "core": false },
				{ "text": "and the mission was completed within the projected $90 million budget", "core": false },
				{ "text": "Weather conditions were ideal with clear skies and minimal winds", "core": false },
				{ "text": "there had been concerns earlier in the day about potential delays", "core": false }
			]
	
			Bad claims extraction (includes modified text):
			[
				"SpaceX successfully launched the Falcon Heavy rocket",
				"from Kennedy Space Center on March 15, 2023",
				"carrying a classified military satellite into orbit",
				"The mission was designated USSF-67", ← WRONG: added "was" 
				"The mission was the rocket's fifth flight", ← WRONG: modified from original
				"The launch was visible for 500 miles", ← WRONG: changed wording
				"The mission was completed within budget" ← WRONG: incomplete/modified
			]
	
			### CRITICAL RULES:
			- NEVER modify the text in ANY way - extract EXACTLY as written in the original
			- VERIFY each claim appears WORD-FOR-WORD in the original text
			- Break down complex statements into more granular, individually verifiable claims
			- Separate location information from action information where possible
			- Separate time/date information where it can stand as its own verifiable claim
			- Separate different attributes or characteristics into individual claims
			- DO NOT include narrative framings like "According to reports" or "Scientists believe"
			- Double-check each extracted claim against the original text to ensure it appears EXACTLY as written
	
			### Expected Output Format:
			{
				"claims": [
					{
						"text": "claim 1 text",
						"core": true
					},
					{
						"text": "claim 2 text",
						"core": false
					}
				]
			}
		`;
  }

  //#endregion
  //#region CLAIM MATCHING
  async matchClaims(parameters, signal = null) {
    if (
      !Array.isArray(parameters.evidences) ||
      !Array.isArray(parameters.claims)
    ) {
      console.error("❌ matchClaims: Invalid evidences or claims input");
      return [];
    }

    if (signal?.aborted) {
      console.warn("⚠️ matchClaims request aborted before execution.");
      return [];
    }

    const settings = this.#claimMatchingSettings();
    const formattedPrompt = settings.prompt
      .replace("{question}", parameters.question)
      .replace("{questionDate}", parameters.questionDate)
      .replace("{response}", parameters.response)
      .replace("{responseDate}", parameters.responseDate)
      .replace(
        "{claims}",
        parameters.claims.map((c, i) => `${i}: "${c}"`).join("\n"),
      )
      .replace(
        "{evidences}",
        parameters.evidences.map((e, i) => `${i}: "${e}"`).join("\n"),
      );

    const results = await this._callLLMAndParse(
      formattedPrompt,
      "matches",
      settings.configurations,
      signal,
    );

    if (signal?.aborted) {
      console.warn("⚠️ matchClaims request aborted after execution.");
      return [];
    }

    return results;
  }

  #defaultClaimMatchingConfig() {
    return ["gpt4o_t_0_2", "sonnet_3_5_v1_t_0_2"];
  }

  #claimMatchingSettings() {
    return {
      prompt: this.claimMatchingPrompt,
      configurations: this.claimMatchingConfig,
    };
  }

  #defaultClaimMatchingPrompt() {
    return `
			You are an **AI fact-checking assistant**. Your task is to analyze a given **response** to a question and determine whether each claim made in the response is **supported, contradicted, or unrelated** based on the available **evidence as of questionDate**.  
			Important: You have to return a single valid JSON object, with no additional comments or explanations.			
			
			### Input:
			- **Question Date:** {questionDate}
			- **Question:** {question}
			- **Response:** {response} 
			- **Claims (extracted from response):** {claims} 
			- **Evidences (available as of {questionDate}):** {evidences}
			
			### Instructions:
			- **Identify the best-matching evidence** for each claim using **0-based indexing**.  
			- Determine whether the evidence **proves the claim (grounding: true), contradicts the claim (grounding: false), or is irrelevant to the claim (grounding: null).  
			- If multiple pieces of evidence match, **select the most relevant ones.  
			- **All claims must be included in the output**—no claim should be missing.  
			- **Do not modify the JSON keys**; they must remain exactly as specified.  
			- The output must be **valid JSON** and should contain **only the Valid JSON object**, with no extra text or comments. 
			- Also extract the minimal pieces of text from the evidence that most closely validate or contradict the claim.  
			- **Do not include words like "JSON" or any explanations in the response.**  
			
			### Expected  Output Format:
			
			{
				'matches': [
					{ 
						'claim': 0, 
						'evidence': 0, 
						'grounding': true,
						'selections': 
							[
								evidence_0_excerpt_1,
								evidence_0_excerpt_2,
								...	
							]
					},
					{ 
						'claim': 1, 
						'evidence': 2, 
						'grounding': false,
							[
								evidence_2_excerpt_1,
								evidence_2_excerpt_2,
								...	
							]
					},
					...
				]
			}
		`;
  }
  //#endregion
  //#region QUERY CREATION
  async createQueries(parameters, signal = null) {
    if (
      !Array.isArray(parameters.evidences) ||
      !Array.isArray(parameters.claims)
    ) {
      console.error("❌ createQueries: Invalid evidences or claims input");
      return [];
    }

    if (signal?.aborted) {
      console.warn("⚠️ createQueries request aborted before execution.");
      return [];
    }

    const settings = this.#queryCreationSettings();
    const formattedPrompt = settings.prompt
      .replace("{question}", parameters.question)
      .replace("{questionDate}", parameters.questionDate)
      .replace("{response}", parameters.response)
      .replace("{responseDate}", parameters.responseDate)
      .replace(
        "{claims}",
        parameters.claims.map((c, i) => `${i}: "${c}"`).join("\n"),
      );

    const results = await this._callLLMAndParse(
      formattedPrompt,
      "queries",
      settings.configurations,
      signal,
    );

    if (signal?.aborted) {
      console.warn("⚠️ createQueries request aborted after execution.");
      return [];
    }

    return results;
  }

  #queryCreationSettings() {
    return {
      prompt: this.queryCreationPrompt,
      configurations: this.queryCreationConfig,
    };
  }

  #defaultQueryCreationConfig() {
    return ["gpt4o_t_0_2", "sonnet_3_5_v1_t_0_2"];
  }

  #defaultQueryCreationPrompt() {
    return `
			You are a helpful assistant tasked with creating concise and optimized Google search queries to retrieve the most relevant information. Given a query, response, and extracted claims, your goal is to extract the most important keywords, group related claims intelligently, and generate an optimized search query.
			Important: You have to return a single valid JSON object, with no additional comments or explanations.						

			### **Input:**
			- **Question:** {question}
			- **Response:**  {response}
			- **Extracted Claims:** {claims}

			### **Guidelines:**
			- **Extract Key Terms:** Identify the most relevant keywords from the response while preserving search intent.
			- **Group Related Claims:** Merge claims that share common themes to enhance search precision.
			- **Format the Query Properly:** Construct the search query using concise, high-impact keywords.
			- **Keep Queries Short:** Avoid unnecessary words while ensuring clarity.
			- **Ensure Clarity:** Use well-defined keywords and avoid ambiguity for better search relevance.
			- **Use Zero-Based Indexing:** Claim indices must start from zero and remain sequential.
			- **Include Every Claim Index:** No claim index should be skipped or omitted.
			- **Ensure Valid JSON:** The final output must be a syntactically valid JSON object.
			- **Concatenate Original Query:** Prepend the original query before keywords for better search intent.

			### **Example Output Format:**
					{
						'queries': [
							{
								'claims': [0, 1],
								'keywords': 'gold price $2758, silver price $32.27, per ounce',
								'query': 'What are the current prices of gold and silver per ounce?'
							},
							{
								'claims': [2, 3, 4],
								'keywords': 'metal demand, global tensions, economic uncertainty',
								'query': 'What factors are contributing to the strong demand for metals?'
							}
						]
					}
		`;
  }
  //#endregion
  //#region SEARCH
  #getOffsetDay(dateString, offset) {
    const [year, month, day] = dateString
      .split("-")
      .map((num) => parseInt(num, 10));
    const date = new Date(year, month - 1, day);

    date.setDate(date.getDate() + offset);

    const newMonth = (date.getMonth() + 1).toString().padStart(2, "0"); // MM
    const newDay = date.getDate().toString().padStart(2, "0"); // DD
    const newYear = date.getFullYear(); // YYYY

    return `${newMonth}/${newDay}/${newYear}`; // ✅ Corrected format for SERP API
  }

  async handleSearch(searchParameters, searchSettings = {}, signal = null) {
    const query = searchParameters.query;
    const questionDate = searchParameters.questionDate;
    const responseDate = searchParameters.responseDate;
    const queryDate = questionDate || responseDate;

    if (!query.trim()) {
      console.warn("⚠️ Empty search query, skipping request.");
      return [];
    }

    if (signal?.aborted) {
      console.warn("⚠️ handleSearch request aborted before execution.");
      return [];
    }

    // 🔹 Extract settings
    const {
      searchIncludeSites = [],
      searchExcludeSites = [
        "quora.com",
        "reddit.com",
        "instagram.com",
        "facebook.com",
        "yahoo.com",
        "linkedin.com",
        "twitter.com",
        "tiktok.com",
        "stackoverflow.com",
      ],
      searchLanguage = "en",
      searchRegion = "us",
    } = searchSettings || {};

    // 🔹 Construct the final query
    let searchQuery = query;

    if (Array.isArray(searchIncludeSites) && searchIncludeSites.length > 0) {
      searchQuery += ` site:${searchIncludeSites.join(" OR site:")}`;
    }
    if (Array.isArray(searchExcludeSites) && searchExcludeSites.length > 0) {
      searchQuery += ` -site:${searchExcludeSites.join(" -site:")}`;
    }

    let searchParams = {
      gl: searchRegion,
      hl: searchLanguage,
      q: searchQuery,
      filter: 1,
    };

    // 🔹 Apply date filtering if needed (Converted to MM/DD/YYYY)
    if (queryDate) {
      searchParams.tbs = `cdr:1,cd_min:${this.#getOffsetDay(queryDate, 0)},cd_max:${this.#getOffsetDay(queryDate, 1)}`;
    }

    // 🔹 Keep working API call name
    const rawResults = await this._callE2fEnhance(
      "webSearchG",
      searchParams,
      signal,
    );

    if (signal?.aborted) {
      console.warn("⚠️ handleSearch request aborted after execution.");
      return [];
    }

    if (rawResults?.organic_results?.length) {
      return rawResults.organic_results;
    }

    console.warn(`⚠️ Query failed or returned no results: ${query}`);

    console.error("❌ Search returned no results. Returning empty result.");
    return [];
  }

  //#endregion
}

class ClaimsManager {
  //#region INITIALIZATION & UI CONTROL

  constructor({ backendSettings = {}, uiSettings = {}, dataSettings = {} }) {
    const {
      claimExtractionPrompt = undefined,
      claimMatchingPrompt = undefined,
      queryCreationPrompt = undefined,
      claimExtractionConfig = undefined,
      claimMatchingConfig = undefined,
      queryCreationConfig = undefined,
    } = backendSettings;

    const {
      localizedText = {},
      language = "en_US",
      displayCoreClaims = false,
      aiEnabled = true, // ✅ FIX: Extract aiEnabled from uiSettings
    } = uiSettings;

    this.language = language;
    this.textManager = window.textManager;
    this.textManager.setLanguage(this.language);
    this.textManager.addTexts(localizedText);

    this.#localizeUISettings(uiSettings);

    const {
      containerId = "",
      multiSelections = false,
      overlapAllowed = false,
      contextFields = [],
      questionFields = [],
      responseFields = [],
      invalidClaimField = null,
      saveSettings = {},
      annotationsField = "",
      claimComments = false,
    } = uiSettings;

    const {
      context = "",
      question = "",
      questionDate = "",
      country = "",
      response = null,
      responseDate = null,
      responses = null,
      responseDates = null,
      annotations = null,
      evidences = null,
    } = dataSettings;

    this.lastSavedAnnotation = "";
    this.backend = new ClaimsBackend(backendSettings);

    this.containerId = typeof containerId === "string" ? containerId : "";
    this.contextFields = contextFields;
    this.questionFields = questionFields;
    this.responseFields = responseFields;
    this.multiSelections = multiSelections;
    this.invalidClaimField = invalidClaimField;
    this.saveSettings = saveSettings;
    this.claimComments = claimComments;
    this.isClaimComments = !!claimComments;
    this.displayCoreClaims = displayCoreClaims;
    this.aiEnabled = aiEnabled; // ✅ FIX: Store aiEnabled setting

    this.questionDate = questionDate || "";
    this.context = context || "";
    this.question = question || "";
    this.country = country || "";
    this.annotationsField = annotationsField || "annotations";
    this.annotations = annotations;

    this.response = "";
    this.responseDate = "";
    this.claims = [];
    this.matches = [];
    this.queries = [];
    this.evidences = evidences || [];
    this.responseFieldValues = [];
    this.questionFieldValues = [];
    this.contextFieldValues = [];
    this.lastSavedAnnotation = "";

    this.all = [];
    this.currentResponseIndex = null;
    this.multipleResponses = this.all.length > 1;
    this.selectedClaimIndex = null;
    this.selectedEvidenceIndex = null;
    this.modes = {};

    this.colors = [
      [90, 90, 220],
      [90, 150, 90],
      [90, 150, 220],
      [90, 220, 150],
      [150, 90, 90],
      [150, 90, 220],
      [150, 150, 90],
      [150, 220, 150],
      [220, 90, 90],
      [220, 150, 90],
      [220, 150, 220],
      [220, 220, 90],
    ];

    this.intersectionColor = "rgba(0, 0, 0, 0.1)";

    this.tabs = {};
    this.areas = {};
    this.actionButtons = {};
    this.container = null;
    this.parentContainer = null;
    this.menuContainer = null;
    this.actionButtonsContainer = null;
    this.workAreaContainer = null;
    this.leftContainer = null;
    this.middleContainer = null;
    this.rightContainer = null;
    this.claimsContainer = null;
    this.evidenceContainer = null;
    this.claimButtonsContainer = null;
    this.evidenceButtonsContainer = null;
    this.messageContainer = null;
    this.claimsMessageContainer = null;
    this.evidenceMessageContainer = null;
    this.built = false;

    this.ongoingRequests = {
      extractClaims: { controller: null, requestId: null, params: null },
      matchClaims: { controller: null, requestId: null, params: null },
      createQueries: { controller: null, requestId: null, params: null },
      search: { controller: null, query: null },
    };

    this.helperManager = new HelperManager(this.containerId);
    this.annotationStatus = {
      context: { complete: false, stopped: false },
      question: { complete: false, stopped: false },
      response: { complete: false, stopped: false },
      search: { complete: false },
      claims: { complete: false },
      evidences: { complete: false },
      canSave: false,
      mustSave: false,
    };

    this.#injectStyles();
    this.#createDOMStructure();
    if (this.multiSelections) this.#addEmptyClaim();
    this.selectedClaimIndex =
      this.claims.length > 1 || !this.multiSelections ? null : 0;
    this.#initializeMainData(responses, responseDates);
    this.#loadAnnotations();

    if (this.context !== "") this.setContext(this.context);
    if (this.questionDate !== "") this.setQuestionDate(this.questionDate);
    if (this.country !== "") this.setCountry(this.country);
    this.setQuestion(this.question);

    this.#switchResponse(0);

    this.mode = this.context === "" ? "question" : "context";
    setTimeout(() => {
      this.#switchTab(this.context !== "" ? "context" : "question", "LeftArea");
    }, 0);

    this.autoSave = null;
    this.autoSaveInterval = this.saveSettings?.autoSaveInterval;
    this.saveStatusField = this.saveSettings?.statusField;
    this._suppressStatusUpdate = false;

    if (
      typeof this.autoSaveInterval === "number" &&
      this.autoSaveInterval > 0
    ) {
      this.#startAutoSave();
    }
  }

  #initializeMainData(responses, responseDates) {
    // ✅ Initialize Context Toggle Manager (Only if context exists)
    if (this.context) {
      this.contextToggleManager = new ToggleManager({
        container: this.contextTogglesContainer,
        toggleFields: this.#createToggleFields(this.contextFields),
        helperManager: this.helperManager,
        onUpdate: (isUserAction) => {
          if (
            this.contextToggleManager &&
            typeof this.contextToggleManager.getToggleFieldValues === "function"
          ) {
            this.contextFieldValues =
              this.contextToggleManager.getToggleFieldValues();
          }
          if (isUserAction) this.#markUnsaved();
          this.#updateAnnotationStatus();
        },
      });
    }

    // ✅ Initialize Question Toggle Manager (Only if question exists)
    if (this.question) {
      this.questionToggleManager = new ToggleManager({
        container: this.questionTogglesContainer,
        toggleFields: this.#createToggleFields(this.questionFields),
        helperManager: this.helperManager,
        onUpdate: (isUserAction) => {
          if (
            this.questionToggleManager &&
            typeof this.questionToggleManager.getToggleFieldValues ===
              "function"
          ) {
            this.questionFieldValues =
              this.questionToggleManager.getToggleFieldValues();
          }
          if (isUserAction) this.#markUnsaved();
          this.#updateAnnotationStatus();
        },
      });
    }

    if (Array.isArray(responses) && responses.length > 0) {
      responses.forEach((resp, index) => {
        this.all.push({
          response: resp,
          responseDate:
            responseDates && responseDates[index] ? responseDates[index] : "",
          selectedClaimIndex: null,
          responseFieldValues: [],
          claims: [],
          matches: [],
          entities: this.#processEntities(resp),
          annotationStatus: {
            responseComplete: null,
            responseStopped: null,
            claimsComplete: null,
            evidencesComplete: null,
            canSave: null,
          },
        });
      });
    } else {
      this.all.push({
        response: responses || "",
        responseDate: responseDates || "",
        selectedClaimIndex: null,
        responseFieldValues: [],
        claims: [],
        matches: [],
        entities: [],
        annotationStatus: {
          responseComplete: null,
          responseStopped: null,
          claimsComplete: null,
          evidencesComplete: null,
          canSave: null,
        },
      });
    }

    // ✅ Always Initialize Response Toggle Manager
    this.responseToggleManager = new ToggleManager({
      container: this.responseTogglesContainer,
      toggleFields: this.#createToggleFields(this.responseFields),
      helperManager: this.helperManager,
      conditions: { onIncorrectClaims: false },
      responseIndex: this.currentResponseIndex,
      onUpdate: (isUserAction) => {
        if (
          this.responseToggleManager &&
          typeof this.responseToggleManager.getToggleFieldValues === "function"
        ) {
          this.responseFieldValues =
            this.responseToggleManager.getToggleFieldValues();
        } else {
          // console.warn("⚠️ Response ToggleManager not ready or missing getToggleFieldValues");
        }
        if (isUserAction) this.#markUnsaved();
        this.#updateAnnotationStatus();
      },
    });

    this.responseFieldValues =
      this.responseToggleManager.getToggleFieldValues();
  }

  #updateAnnotationStatus(switchTab = true) {
    const previousStatus = JSON.stringify(this.annotationStatus);

    const contextComplete = this.contextToggleManager
      ? this.contextToggleManager.isComplete()
      : true;
    const questionComplete = this.questionToggleManager
      ? this.questionToggleManager.isComplete()
      : true;

    const contextStopped = this.contextToggleManager?.isStopped() === true;
    const questionStopped = this.questionToggleManager?.isStopped() === true;
    const searchComplete = this.evidences.length > 0;

    const responseComplete = this.responseToggleManager
      ? this.responseToggleManager.isComplete()
      : true;
    const responseStopped = this.responseToggleManager?.isStopped() === true;
    const claimsComplete = this.claims.length > 0;
    const coreComplete = this.displayCoreClaims
      ? this.claims.some((claim) => claim.core === true)
      : true;
    const evidencesComplete =
      claimsComplete &&
      searchComplete &&
      this.claims.every(
        (claim) =>
          claim.groundingEvidences &&
          Object.keys(claim.groundingEvidences).length > 0,
      );

    if (this.all.length > 0 && this.currentResponseIndex !== null) {
      this.all[this.currentResponseIndex].annotationStatus = {
        responseStopped: responseStopped,
        responseComplete: responseComplete,
        claimsComplete: claimsComplete,
        coreComplete: coreComplete,
        evidencesComplete: evidencesComplete,
        canSave:
          responseStopped ||
          (responseComplete &&
            claimsComplete &&
            coreComplete &&
            evidencesComplete),
      };
    }

    const canSaveResponses = this.all.every(
      (response) => response.annotationStatus?.canSave === true,
    );
    const allResponsesStopped = this.all.every(
      (response) => response.annotationStatus?.responseStopped === true,
    );

    const allComplete =
      contextComplete && questionComplete && searchComplete && canSaveResponses;
    const stopped = contextStopped || questionStopped || responseStopped;
    const mustStop = contextStopped || questionStopped || allResponsesStopped;

    this.annotationStatus = {
      context: { complete: contextComplete, stopped: contextStopped },
      question: { complete: questionComplete, stopped: questionStopped },
      response: { complete: responseComplete, stopped: responseStopped },
      search: { complete: searchComplete, coreComplete: coreComplete },
      claims: { complete: claimsComplete },
      evidences: { complete: evidencesComplete },
      mustStop: mustStop,
      canSave: mustStop || allComplete,
      stopped,
    };

    const statusChanged =
      JSON.stringify(this.annotationStatus) !== previousStatus;

    // ✅ Mark unsaved whenever user changes answers (prevents stale "saved" state)
    if (
      statusChanged &&
      !this._suppressStatusUpdate &&
      this.saveStatusField &&
      typeof survey?.setValue === "function"
    ) {
      survey.setValue(this.saveStatusField, true);
    }

    if (switchTab && statusChanged) {
      this.#switchTab(this.currentTab, "LeftArea");
      this.#refreshActionButtons();
    }
  }

  #markUnsaved() {
    if (this._suppressStatusUpdate) return;
    if (this.saveStatusField && typeof survey?.setValue === "function") {
      survey.setValue(this.saveStatusField, true);
    }
  }

  //#endregion

  //#region STYLES

  #injectStyles() {
    let styleTag = document.getElementById("claims-styles");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "claims-styles";
      styleTag.textContent = this.styles;
      document.head.appendChild(styleTag);
    }
  }

  #applyPanelStyles(panel) {
    panel.style.width = "100%";
    panel.style.padding = "10px";
    panel.style.borderTop = "none";
    panel.style.backgroundColor = "#ffffff";
    panel.style.display = "none";
  }

  #applyLabelValueStyles(container) {
    container.style.fontSize = "16px"; // ✅ SAME SIZE EVERYWHERE
    container.style.color = "black";
    container.style.paddingBottom = "5px";
  }

  #applyPromptContainerStyles(container) {
    container.style.marginBottom = "10px";
    container.style.padding = "8px";
    container.style.border = "1px solid #ccc";
    container.style.borderRadius = "4px";
    container.style.backgroundColor = "#f9f9f9";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "4px";
  }

  #applyInputWrapperStyles(wrapper) {
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.gap = "5px";
  }

  #applySearchInputStyles(input) {
    input.style.width = "100%";
    input.style.height = "80px";
    input.style.padding = "8px";
    input.style.border = "1px solid #ccc";
    input.style.borderRadius = "4px";
  }

  #applySearchButtonStyles(button) {
    button.style.display = "inline-block";
    button.style.padding = "6px 12px";
    button.style.backgroundColor = "#007bff";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    button.style.fontSize = "14px";
    button.style.minWidth = "80px";
    button.style.textAlign = "center";
  }

  #applySearchContainerStyles(container) {
    container.classList.add("search-container");
    container.style.flex = "1";
    container.style.overflowY = "auto";
    container.style.padding = "10px";
    container.style.backgroundColor = "#ffffff";
    container.style.maxHeight = "100%";
  }

  #applySearchResultContainerStyles(container) {
    container.style.marginTop = "5px";
    container.style.border = "1px solid #ccc";
    container.style.backgroundColor = "#f9f9f9";
    container.style.overflowY = "auto";
    container.style.padding = "0px";
    container.style.display = "none";
    container.style.flexGrow = "1";
  }

  //#endregion

  //#region LOCALIZATION & HELP MANAGEMENT

  #t(key) {
    // text
    return this.textManager.getText(key);
  }
  #lt(key) {
    // label text
    return this.#t(`lbl_${key}`);
  }
  #bt(key) {
    // button text
    return this.#t(`btn_${key}`);
  }
  #et(key) {
    // error text
    return this.#t(`err_${key}`);
  }
  #it(key) {
    // info text
    return this.#t(`inf_${key}`);
  }
  #ht(key) {
    // help text
    return this.#t(`hlp_${key}`);
  }

  #addHelp(targetElement, tooltipText) {
    if (!targetElement) {
      console.error("❌ Target element does not exist.");
      return;
    }

    const helpIcon = this.helperManager.createHelpIcon(tooltipText);
    targetElement.appendChild(helpIcon);
  }

  #localizeUISettings(settings) {
    const localizeKeys = (obj) => {
      if (Array.isArray(obj)) {
        obj.forEach((item) => localizeKeys(item)); // ✅ Recurse into arrays
      } else if (typeof obj === "object" && obj !== null) {
        for (let key in obj) {
          if (key.endsWith("Key")) {
            const baseKey = key.slice(0, -3);
            const val = obj[key];

            if (obj[baseKey] === undefined) {
              // ✅ Only add if not already defined
              if (typeof val === "string") {
                obj[baseKey] = this.#t(val);
              } else if (Array.isArray(val)) {
                obj[baseKey] = val.map((v) => this.#t(v));
              }
            }
          }

          // ✅ NEW: also localize any nested objects
          if (typeof obj[key] === "object" && obj[key] !== null) {
            localizeKeys(obj[key]);
          }
        }
      }
    };

    Object.keys(settings).forEach((key) => {
      localizeKeys(settings[key]);
    });
  }

  //#endregion

  //#region MAIN DOM MANAGEMENT

  #hideSurveyJSDivs(container) {
    /* DISABLE UNTIL WE KNOW EXACTLY WHICH DIV TO HIDE
		// Traverse up 4 levels to get x
		let x = container;
		for (let i = 0; i < 6; i++) {
			if (x.parentElement) {
				x = x.parentElement;
			} else {
				console.warn('Not enough parent elements.');
				break;
			}
		}

		// Hide x's first child if it exists
		if (x && x.firstElementChild) {
			x.firstElementChild.style.display = 'none';
		} else {
			console.warn('x does not have a first child.');
		}
		*/
  }

  #createDOMStructure() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container with ID '${this.containerId}' not found.`);
      return;
    }

    this.#hideSurveyJSDivs(container);

    // ✅ Ensure Parent Container is Set Up **Before** Work Area
    const parentContainer = container.parentElement;
    parentContainer.style.display = "flex";
    parentContainer.style.flexDirection = "column"; // ✅ Vertical stacking
    parentContainer.style.height = "100vh"; // ✅ Full height for stretching
    parentContainer.style.overflow = "hidden";

    // ✅ Configure Main Claims Container
    container.innerHTML = "";
    container.classList.add("claims-container");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.flexGrow = "1"; // ✅ Ensures it stretches
    container.style.height = "100%";

    this.#createMenuContainer(container);
    this.#createActionButtonsContainer();
    this.#createActionButtons();

    // ✅ Create Work Area **After** Parent Setup
    this.#createWorkAreaContainer(container);

    this.#createMessageContainer(); // 🔹 Search progress
    this.#createLeftTabbedContainer();

    this.#createEvidenceTitleContainer();
    this.#createEvidencesMessageContainer(); // 🔹 Matching progress
    this.#createEvidenceButtonsContainer();
    this.#createEvidenceContainer(); // ✅ Called explicitly

    this.#createClaimTitleContainer();
    this.#createClaimsMessageContainer(); // 🔹 General messages
    this.#createClaimButtonsContainer();
    this.#createClaimsContainer();

    this.built = true;
  }

  #createMenuContainer(container) {
    this.menuContainer = document.createElement("div");
    this.menuContainer.classList.add("menu-container");

    // ✅ Reduce margin-bottom to minimize spacing
    this.menuContainer.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 8px; /* Reduce gap for compact layout */
			margin-bottom: 5px; /* Reduce space between menu and work area */
			padding: 8px; /* Slightly reduce padding */
			border: 1px solid #d3d3d3;
			border-radius: 6px;
			background-color: #ffffff;
			box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.08); /* Lighter shadow */
		`;

    container.appendChild(this.menuContainer);
  }

  #createWorkAreaContainer(container) {
    this.workAreaContainer = document.createElement("div");
    this.workAreaContainer.classList.add("work-area-container");
    this.workAreaContainer.style.display = "flex";
    this.workAreaContainer.style.flexDirection = "row"; // ✅ Horizontal Layout
    this.workAreaContainer.style.width = "100%";
    this.workAreaContainer.style.height = "100%"; // ✅ Full Height Fix
    this.workAreaContainer.style.overflow = "hidden";
    this.workAreaContainer.style.boxSizing = "border-box";
    this.workAreaContainer.style.alignItems = "stretch";
    container.appendChild(this.workAreaContainer);

    // ✅ Use actual `ClaimsManager` containers
    this.leftContainer = document.createElement("div");
    this.leftContainer.classList.add("left-container");
    this.leftContainer.style.overflow = "auto";
    this.leftContainer.style.minHeight = "0";
    this.leftContainer.style.flex = "none";

    this.middleContainer = document.createElement("div");
    this.middleContainer.classList.add("middle-container");
    this.middleContainer.style.overflow = "auto";
    this.middleContainer.style.minHeight = "0";
    this.middleContainer.style.flex = "none";

    this.rightContainer = document.createElement("div");
    this.rightContainer.classList.add("right-container");
    this.rightContainer.style.overflow = "auto";
    this.rightContainer.style.minHeight = "0";
    this.rightContainer.style.flex = "none";

    // ✅ Ensure height adjusts correctly on window resize
    this.#refreshWorkArea();
    window.addEventListener("resize", this.#refreshWorkArea.bind(this));
  }

  #refreshWorkArea(attempts = 0) {
    if (typeof attempts !== "number") {
      attempts = 0; // 🔹 Reset to 0 if it's an event
    }

    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error("❌ Container not found.");
      return;
    }

    const parentContainer = container.parentNode;
    const parentComputedStyle = window.getComputedStyle(parentContainer);

    // ---- Height Adjustment ----
    const menuHeight = this.menuContainer?.getBoundingClientRect().height || 0;
    const spacing = 10; // Space between elements (like margin or padding)
    const paddingOffset =
      parseInt(parentComputedStyle.paddingTop, 10) +
      parseInt(parentComputedStyle.paddingBottom, 10);

    // Calculate available height for work area
    const totalHeight =
      window.innerHeight - menuHeight - spacing - paddingOffset;
    this.workAreaContainer.style.height = `${totalHeight}px`;

    // ---- Width Adjustment ----
    const menuWidth = this.menuContainer?.getBoundingClientRect().width || 0;
    const paddingWidthOffset =
      parseInt(parentComputedStyle.paddingLeft, 10) +
      parseInt(parentComputedStyle.paddingRight, 10);

    // Calculate available width for work area
    const totalWidth =
      window.innerWidth - menuWidth - spacing - paddingWidthOffset;
    this.workAreaContainer.style.width = `${totalWidth}px`;

    // ---- Remove Old Splitters ----
    if (this.splitter) {
      // Destroy previous splitter instance
      this.splitter.splitters.forEach((splitter) => {
        splitter.remove();
      });
      this.splitter = null;
    }

    // ---- Recreate Splitters ----
    this.splitter = new MultiPanelSplitter(this.workAreaContainer, [
      this.leftContainer,
      this.middleContainer,
      this.rightContainer,
    ]);

    // 🛠️ Fix for Scroll Issue: Ensure searchContainer is scrollable
    if (this.searchContainer) {
      this.searchContainer.style.maxHeight = "none"; // Prevent artificial height limits
      this.searchContainer.style.overflowY = "auto"; // Ensure scrolling works
    }

    // In case the width or height calculation failed, try again a couple of times
    if (attempts < 2 && (isNaN(totalWidth) || isNaN(totalHeight))) {
      setTimeout(() => this.#refreshWorkArea(attempts + 1), 200);
    }
  }

  #createMessageContainer() {
    this.messageContainer = document.createElement("div");
    this.messageContainer.id = "message-container";
    this.messageContainer.style.cssText = `
			width: 100%;
			text-align: center;
			font-size: 14px; /* ✅ Uniform size */
			font-weight: normal; /* ✅ Not bold */
			color: red; /* ✅ Consistent red */
			padding: 5px;
			display: none;
			border-bottom: 1px solid #ddd;
		`;

    // 🔹 Insert it under the tabbed container in the left panel
    this.leftContainer.appendChild(this.messageContainer);
  }

  //#endregion

  //#region MENU MANAGEMENT

  #lightenColor(rgbArray, factor = 0.8) {
    const [r, g, b] = rgbArray;
    return `rgb(
			${Math.min(255, Math.floor(r + (255 - r) * factor))}, 
			${Math.min(255, Math.floor(g + (255 - g) * factor))}, 
			${Math.min(255, Math.floor(b + (255 - b) * factor))}
		)`;
  }

  #createActionButtonsContainer() {
    this.actionButtonsContainer = document.createElement("div");
    this.actionButtonsContainer.classList.add("action-buttons-container");
    this.actionButtonsContainer.style.display = "flex";
    this.actionButtonsContainer.style.gap = "10px";
    this.actionButtonsContainer.style.width = "100%";
    this.actionButtonsContainer.style.marginTop = "10px";
    this.actionButtonsContainer.style.justifyContent = "space-between";
    this.actionButtonsContainer.style.alignItems = "center";
    this.actionButtonsContainer.innerHTML = "";
    this.menuContainer.appendChild(this.actionButtonsContainer);
  }

  #createContainerButtons(container, buttons) {
    const buttonBackgroundColor = "#007bff";
    const buttonColor = "white";

    buttons.forEach((button) => {
      const actionButton = document.createElement("button");
      actionButton.textContent = this.#bt(button.labelKey);
      actionButton.classList.add("menu-button");
      actionButton.style.backgroundColor =
        button.backgroundColor || buttonBackgroundColor;
      actionButton.style.color = button.color || buttonColor;
      actionButton.style.display = "none";
      actionButton.addEventListener("click", () => button.handler());

      container.appendChild(actionButton);

      if (button.name) {
        this[button.name] = actionButton;
        this.actionButtons[button.name] = actionButton;
      }
    });
  }

  #createActionButtons() {
    const leftActionContainer = document.createElement("div");
    leftActionContainer.style.display = "flex";
    leftActionContainer.style.gap = "10px";

    const rightActionContainer = document.createElement("div");
    rightActionContainer.style.display = "flex";
    rightActionContainer.style.gap = "10px";

    this.#createContainerButtons(leftActionContainer, [
      {
        name: "extractClaims",
        labelKey: "extract_claims",
        handler: () => this.#extractClaims(this.response),
      },
      {
        name: "addClaim",
        labelKey: "add_claim",
        handler: () => this.#addSimpleClaim(),
      },
      {
        name: "addToSelection",
        labelKey: "add_toclaim",
        handler: () => this.#addToSelections(),
      },
      {
        name: "adjustClaim",
        labelKey: "adjust_claim",
        handler: () => this.#adjustClaim(),
      },
      {
        name: "splitClaim",
        labelKey: "split_claim",
        handler: () => this.#splitClaim(),
      },
      {
        name: "mergeClaims",
        labelKey: "merge_claims",
        handler: () => this.#mergeClaims(),
      },
      {
        name: "recordClaim",
        labelKey: "record_claim",
        handler: () => this.#addEmptyClaim(),
      },
      {
        name: "createQueries",
        labelKey: "create_queries",
        handler: () => this.#createQueries(),
      },
      {
        name: "searchClaims",
        labelKey: "search_claims",
        handler: () => this.#handleSearch("claims"),
      },
      {
        name: "searchKeywords",
        labelKey: "search_keywords",
        handler: () => this.#handleSearch("keywords"),
      },
      {
        name: "searchQuestion",
        labelKey: "search_question",
        handler: () => this.#handleSearch("text", this.question),
      },
      {
        name: "addEvidence",
        labelKey: "add_evidence",
        handler: () => this.#handleAddEvidence(),
      },
      {
        name: "matchClaims",
        labelKey: "match_claims",
        handler: () => this.#matchClaims(),
      },
    ]);

    this.#createContainerButtons(rightActionContainer, [
      {
        name: "clear",
        labelKey: "clear_selections",
        handler: () => this.#clearSelections(),
      },
      { name: "help", labelKey: "help", handler: () => console.log(Help) },
      {
        name: "nextResponse",
        labelKey: "next_response",
        handler: () => this.#nextResponse(),
      },
      {
        name: "save",
        labelKey: "save",
        handler: () => this.#saveAnnotations(true),
      },
    ]);

    this.actionButtonsContainer.appendChild(leftActionContainer);
    this.actionButtonsContainer.appendChild(rightActionContainer);
  }

  #hideActionButtons(names = null) {
    Object.values(this.actionButtons).forEach((button) => {
      if (names === null || names.includes(button.name)) {
        button.style.display = "none";
      }
    });
  }

  #showActionButtons(names = null) {
    Object.keys(this.actionButtons).forEach((name) => {
      if (names === null || names.includes(name)) {
        this.actionButtons[name].style.display = "block";
      }
    });
  }

  #updateButtonLabel(buttonName, label) {
    if (this.actionButtons[buttonName]) {
      this.actionButtons[buttonName].textContent = label;
    } else {
      console.warn(`⚠️ Button "${buttonName}" not found.`);
    }
  }

  #refreshActionButtons() {
    if (!this.annotationStatus) return;

    this.#hideActionButtons();

    if (this.annotationStatus.mustStop) {
      this.#showActionButtons(["help", "save"]);
      return;
    }

    const hasClaims = this.claims.length > 0;
    const hasNext = this.selectedClaimIndex < this.claims.length - 1;
    const isAllButton = this.selectedClaimIndex === null;
    const hasQueries = this.queries.length > 0;

    switch (this.mode) {
      case "response": {
        if (this.multiSelections) {
          const selections =
            this.claims[this.selectedClaimIndex]?.selections || [];
          const hasSelections = selections.length > 0;

          this.#showActionButtons([
            "addClaim",
            ...(hasSelections
              ? ["addToSelection", "clear", "recordClaim"]
              : []),
          ]);
        } else {
          this.#showActionButtons([
            ...(this.aiEnabled && !hasClaims ? ["extractClaims"] : []), // ✅ FIX: only show Extract Claims if aiEnabled
            ...(isAllButton ? ["addClaim"] : []),
            ...(!isAllButton
              ? ["adjustClaim", "splitClaim", "mergeClaims"]
              : []),
          ]);
        }
        break;
      }

      case "search": {
        const hasMatches = this.claims.length > 0 && this.evidences.length > 0;
        this.#showActionButtons([
          ...(!isAllButton && hasQueries
            ? ["searchClaims", "searchKeywords"]
            : []),
          ...(isAllButton ? ["searchQuestion"] : []),
          ...(isAllButton && this.aiEnabled && hasClaims
            ? ["createQueries"]
            : []), // ✅ FIX: only show Create Queries if aiEnabled
          "addEvidence",
          ...(isAllButton && this.aiEnabled && hasMatches
            ? ["matchClaims"]
            : []), // ✅ FIX: only show Match Claims if aiEnabled
        ]);
        break;
      }
    }

    if (!isAllButton && hasQueries) {
      const query = this.queries.find((q) =>
        q.claims.includes(this.selectedClaimIndex),
      );
      const claimsDisplay = JSON.stringify(query.claims.map((n) => n + 1));
      this.#updateButtonLabel(
        "searchClaims",
        `${this.#bt("search_claims")} ${claimsDisplay}`,
      );
      this.#updateButtonLabel(
        "searchKeywords",
        `${this.#bt("search_keywords")} ${claimsDisplay}`,
      );
    }

    this.#showActionButtons(["help"]);
    if (this.annotationStatus.canSave) this.#showActionButtons(["save"]);
    if (this.all.length > 1) this.#showActionButtons(["nextResponse"]);
  }

  //#endregion

  //#region TABS MANAGEMENT

  #createTabbedContainer(parentContainer, areaName, tabs, defaultTab) {
    const container = document.createElement("div");
    container.classList.add("tabbed-container");
    container.style.width = "100%";
    container.style.display = "flex";
    container.style.justifyContent = "flex-start";
    container.style.gap = "1px";
    container.style.padding = "5px 10px";
    container.style.borderBottom = "2px solid #ccc";
    container.style.backgroundColor = "#f9f9f9";

    this.tabs[areaName] = {};
    this.areas[areaName] = {};
    this.modes[areaName] = {}; // Store modes for each tab

    tabs.forEach(({ labelKey, tabName, createFunction, mode }) => {
      this.tabs[areaName][tabName] = this.#createTab(
        areaName,
        labelKey,
        tabName,
        mode,
      );
      container.appendChild(this.tabs[areaName][tabName]);

      const panel = createFunction.call(this, parentContainer);
      if (!panel) {
        console.error(
          `Panel creation function for '${tabName}' in '${areaName}' returned undefined.`,
        );
        return;
      }

      this.areas[areaName][tabName] = panel;
      this.areas[areaName][tabName].style.display =
        tabName === defaultTab ? "block" : "none";
      this.modes[areaName][tabName] = mode; // Store mode linked to this tab
      parentContainer.appendChild(this.areas[areaName][tabName]);
    });

    parentContainer.insertBefore(container, parentContainer.firstChild);
  }

  #createLeftTabbedContainer() {
    this.#createTabbedContainer(
      this.leftContainer,
      "LeftArea",
      [
        ...(this.context !== ""
          ? [
              {
                labelKey: "context",
                tabName: "context",
                createFunction: this.#createContextPanel,
                mode: "context",
              },
            ]
          : []),
        ...(this.question !== ""
          ? [
              {
                labelKey: "question",
                tabName: "question",
                createFunction: this.#createQuestionPanel,
                mode: "question",
              },
            ]
          : []),
        {
          labelKey: "response",
          tabName: "response",
          createFunction: this.#createResponsePanel,
          mode: "response",
        },
        {
          labelKey: "search",
          tabName: "search",
          createFunction: this.#createSearchPanel,
          mode: "search",
        },
      ],
      this.context !== ""
        ? "context"
        : this.question !== ""
          ? "question"
          : "response",
    );
  }

  #createTab(areaName, labelKey, tabName) {
    const tab = document.createElement("div");
    tab.textContent = this.#lt(labelKey);
    tab.classList.add("tab");

    tab.style.display = "flex"; // ✅ Ensures proper centering
    tab.style.alignItems = "center"; // ✅ Center vertically
    tab.style.justifyContent = "center"; // ✅ Center horizontally
    tab.style.padding = "8px 16px";
    tab.style.cursor = "pointer";
    tab.style.borderRadius = "8px 8px 0 0";
    tab.style.backgroundColor = "#d0d0d0";
    tab.style.border = "1px solid #ccc";
    tab.style.borderBottom = "none";
    tab.style.transition = "background 0.3s ease";
    tab.style.textAlign = "center"; // ✅ Ensures text is centered

    tab.addEventListener("click", () => this.#switchTab(tabName, areaName));

    // Store reference to response tab for future name changes
    if (areaName === "LeftArea" && labelKey === "response") {
      this.responseTab = tab;
    }
    return tab;
  }

  #switchTab(tabName, areaName) {
    this.#updateAnnotationStatus(); // ✅ Ensure status is updated before switching

    if (!this.areas[areaName]) {
      console.error(`❌ Area '${areaName}' not initialized in this.areas.`);
      return;
    }

    if (!this.areas[areaName][tabName]) {
      console.warn(`⚠️ Panel '${tabName}' not found in '${areaName}'.`);
      return;
    }

    // ✅ Color handling for complete/stopped states
    const statusColors = {
      complete: { default: "#a0e0a0", selected: "#28a745", text: "#ffffff" }, // Light green, Bright green (white text)
      stopped: { default: "#e0a0a0", selected: "#dc3545", text: "#ffffff" }, // Light red, Bright red (white text)
      default: { default: "#d0d0d0", selected: "#ffffff", text: "#000000" }, // Gray, White (black text)
    };

    // 🔹 Track selected tab and area
    this.currentTab = tabName;
    this.currentArea = areaName;

    // 🔹 Update mode
    this.mode = this.modes[areaName][tabName] || "default";

    // 🔹 Hide Search Input field if not in Search tab
    if (this.searchPanel) {
      this.searchPanel.style.display = tabName === "search" ? "block" : "none"; // ✅ Minimal Fix
    }

    Object.keys(this.tabs[areaName]).forEach((key) => {
      let bgColor = statusColors.default.default;
      let textColor = statusColors.default.text;
      let tabStatus = this.annotationStatus[key];

      if (tabStatus) {
        if (tabStatus.stopped) {
          bgColor = statusColors.stopped.default;
        } else if (tabStatus.complete) {
          bgColor = statusColors.complete.default;
        }
      }

      this.tabs[areaName][key].style.backgroundColor = bgColor;
      this.tabs[areaName][key].style.color = textColor;
      this.tabs[areaName][key].style.fontWeight = "normal";
    });

    // 🔹 Apply selected tab styles
    let selectedTabStatus = this.annotationStatus[tabName];
    let selectedBgColor = statusColors.default.selected;
    let selectedTextColor = statusColors.default.text;

    if (selectedTabStatus) {
      if (selectedTabStatus.stopped) {
        selectedBgColor = statusColors.stopped.selected;
        selectedTextColor = statusColors.stopped.text;
      } else if (selectedTabStatus.complete) {
        selectedBgColor = statusColors.complete.selected;
        selectedTextColor = statusColors.complete.text;
      }
    }

    this.tabs[areaName][tabName].style.backgroundColor = selectedBgColor;
    this.tabs[areaName][tabName].style.color = selectedTextColor;
    this.tabs[areaName][tabName].style.fontWeight = "bold";

    if (this.all.length > 1) {
      this.responseTab.textContent = `${this.#lt("response")} ${this.currentResponseIndex + 1}`;
    }

    this.#refreshContainer();
  }

  //#endregion

  //#region CONTEXT PANEL

  #createContextPanel(parentContainer) {
    this.contextPanel = document.createElement("div");
    this.contextPanel.classList.add("context-panel");
    this.#applyPanelStyles(this.contextPanel);

    // ✅ Context Text Container
    this.contextTextContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.contextTextContainer);
    this.contextPanel.appendChild(this.contextTextContainer);

    this.contextTogglesContainer = document.createElement("div");
    this.contextTogglesContainer.style.paddingTop = "10px";
    this.contextTogglesContainer.style.backgroundColor = "#f4f4f4";
    this.contextPanel.appendChild(this.contextTogglesContainer);

    parentContainer.appendChild(this.contextPanel);
    return this.contextPanel;
  }

  #refreshContextPanel() {
    if (this.contextPanel) {
      this.contextPanel.style.display =
        this.mode === "context" ? "block" : "none";
    }
  }

  #createToggleFields(fields, displayYesNo = null) {
    return fields.map((field) => {
      if (field.type === "Yes/No") {
        // For Yes/No fields, set the display array (using provided displayYesNo or default labels)
        return {
          ...field,
          display: displayYesNo
            ? [this.#lt(displayYesNo[0]), this.#lt(displayYesNo[1])]
            : [this.#lt("yes"), this.#lt("no")],
        };
      } else {
        // For other types (Selection or Text), leave the field unchanged.
        return field;
      }
    });
  }

  setContext(contextData) {
    this.contextTextContainer.innerHTML = ""; // Clear previous content

    if (!contextData) {
      this.contextTextContainer.textContent = ""; // Handle null case
      return;
    }

    if (typeof contextData === "string") {
      this.contextTextContainer.textContent = contextData;
    } else if (Array.isArray(contextData)) {
      // Handle context as an array of question-response pairs
      contextData.forEach((entry) => {
        const entryContainer = document.createElement("div");
        entryContainer.style.marginBottom = "10px";

        // 🔹 Question Label (Expandable)
        const questionLabel = document.createElement("div");
        questionLabel.innerHTML = `<strong>${this.#lt("question")}</strong>`;
        questionLabel.classList.add("context-label");
        questionLabel.addEventListener("click", () => {
          questionText.style.display =
            questionText.style.display === "none" ? "block" : "none";
        });

        // 🔹 Question Text
        const questionText = document.createElement("div");
        questionText.textContent = entry.prompt;
        questionText.classList.add("context-text");
        questionText.style.display = "block";

        // 🔹 Response Label (Expandable)
        const responseLabel = document.createElement("div");
        responseLabel.innerHTML = `<strong>${this.#lt("response")}</strong>`;
        responseLabel.classList.add("context-label");
        responseLabel.addEventListener("click", () => {
          responseText.style.display =
            responseText.style.display === "none" ? "block" : "none";
        });

        // 🔹 Response Text
        const responseText = document.createElement("div");
        responseText.textContent = entry.response;
        responseText.classList.add("context-text");
        responseText.style.display = "block";

        // Append elements
        entryContainer.appendChild(questionLabel);
        entryContainer.appendChild(questionText);
        entryContainer.appendChild(responseLabel);
        entryContainer.appendChild(responseText);

        this.contextTextContainer.appendChild(entryContainer);
      });
    }
  }

  //#endregion

  //#region QUESTION PANEL

  #createQuestionPanel(parentContainer) {
    this.questionPanel = document.createElement("div");
    this.questionPanel.classList.add("question-panel");
    this.#applyPanelStyles(this.questionPanel);

    // ✅ Question Date Container
    this.questionDateContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.questionDateContainer);
    this.questionPanel.appendChild(this.questionDateContainer);

    // ✅ Country Container (above question)
    this.questionCountryContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.questionCountryContainer);
    this.questionCountryContainer.style.display = "none";
    this.questionPanel.appendChild(this.questionCountryContainer);

    // ✅ Question Text Container
    this.questionTextContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.questionTextContainer);
    this.questionPanel.appendChild(this.questionTextContainer);

    this.questionTogglesContainer = document.createElement("div");
    this.questionTogglesContainer.style.paddingTop = "10px";
    this.questionTogglesContainer.style.backgroundColor = "#f4f4f4";
    this.questionPanel.appendChild(this.questionTogglesContainer);

    parentContainer.appendChild(this.questionPanel);
    return this.questionPanel;
  }

  #refreshQuestionPanel() {
    if (this.questionPanel) {
      this.questionPanel.style.display =
        this.mode === "question" ? "block" : "none";
    }
  }

  setQuestionDate(date) {
    this.questionDate = date;

    if (this.questionDateContainer) {
      this.questionDateContainer.innerHTML = `<strong>${this.#lt("question_date")}:</strong> <span style="font-weight: normal;">${date}</span>`;
    }

    if (this.searchQuestionDateContainer) {
      this.searchQuestionDateContainer.innerHTML = `<strong>${this.#lt("question_date")}:</strong> <span style="font-weight: normal;">${date}</span>`;
    }

    // 🔹 If there's a question date, show the checkbox and hide the response checkbox
    if (this.searchDateCheckboxQuestion) {
      this.searchDateCheckboxQuestion.style.display = "inline-block";
      this.searchDateCheckboxResponse.style.display = "none"; // 🔹 Hide response checkbox
      this.searchWithDate = this.searchDateCheckboxQuestion.checked; // ✅ Track selection
    }
  }

  setCountry(country) {
    this.country = country;

    if (this.questionCountryContainer) {
      if (country) {
        this.questionCountryContainer.innerHTML = `<strong>${this.#lt("country")}:</strong> <span style="font-weight: normal;">${country}</span>`;
        this.questionCountryContainer.style.display = "block";
      } else {
        this.questionCountryContainer.innerHTML = "";
        this.questionCountryContainer.style.display = "none";
      }
    }

    if (this.responseCountryContainer) {
      if (country) {
        this.responseCountryContainer.innerHTML = `<strong>${this.#lt("country")}:</strong> <span style="font-weight: normal;">${country}</span>`;
        this.responseCountryContainer.style.display = "block";
      } else {
        this.responseCountryContainer.innerHTML = "";
        this.responseCountryContainer.style.display = "none";
      }
    }
  }

  setQuestion(question) {
    this.question = question;

    if (this.questionTextContainer) {
      this.questionTextContainer.innerHTML = `<strong>${this.#lt("question")}:</strong> <span style="font-weight: normal;">${question}</span>`;
    }

    if (this.searchQuestionTextContainer) {
      this.searchQuestionTextContainer.innerHTML = `<strong>${this.#lt("question")}:</strong> <span style="font-weight: normal;">${question}</span>`;
    }
  }
  // #endregion

  //#region RESPONSE PANEL

  #createResponsePanel(parentContainer) {
    this.responsePanel = document.createElement("div");
    this.responsePanel.classList.add("response-panel");
    this.#applyPanelStyles(this.responsePanel);

    // ✅ Country Container (above response date)
    this.responseCountryContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.responseCountryContainer);
    this.responseCountryContainer.style.display = "none";
    this.responsePanel.appendChild(this.responseCountryContainer);

    // ✅ Response Date Container
    this.responseDateContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.responseDateContainer);
    this.responsePanel.appendChild(this.responseDateContainer);

    // ✅ Response Text Container
    this.responseTextContainer = document.createElement("div");
    this.#applyLabelValueStyles(this.responseTextContainer);
    this.responsePanel.appendChild(this.responseTextContainer);

    this.responseTogglesContainer = document.createElement("div");
    this.responseTogglesContainer.style.paddingTop = "10px";
    this.responseTogglesContainer.style.backgroundColor = "#f4f4f4";
    this.responsePanel.appendChild(this.responseTogglesContainer);

    parentContainer.appendChild(this.responsePanel);
    return this.responsePanel;
  }

  #nextResponse() {
    if (this.all.length <= 1) return; // Nothing to switch if only one response
    this.#switchResponse((this.currentResponseIndex + 1) % this.all.length);
  }

  #switchResponse(index, silent = false) {
    if (!this.all[index]) return; // Safety check
    if (this.ongoingRequests.extractClaims.controller) {
      this.ongoingRequests.extractClaims.controller.abort();
    }
    if (this.ongoingRequests.matchClaims.controller) {
      this.ongoingRequests.matchClaims.controller.abort();
    }

    if (this.currentResponseIndex !== null) {
      this.all[this.currentResponseIndex] = {
        response: this.response,
        responseDate: this.responseDate,
        claims: this.claims,
        matches: this.matches,
        queries: this.queries,
        selectedClaimIndex: this.selectedClaimIndex,
        responseFieldValues: this.responseFieldValues,
        entities: this.entities,
      };
      this.#updateAnnotationStatus(false);
    }

    // 🔹 Switch to the new response
    if (!silent) {
      this.currentResponseIndex = index;
      const response = this.all[index];
      this.response = response.response;
      this.responseDate = response.responseDate;
      this.claims = response.claims || [];
      this.matches = response.matches || [];
      this.queries = response.queries || [];
      this.selectedClaimIndex = response.selectedClaimIndex ?? null;
      this.entities = response.entities || [];
      this.responseFieldValues = response.responseFieldValues || [];

      const hasIncorrectClaims = this.claims.some(
        (claim) => claim.grounding === false,
      );
      this.responseToggleManager.setToggleFieldValues({
        responseIndex: index,
        values: this.responseFieldValues,
        conditions: { onIncorrectClaims: hasIncorrectClaims },
      });
      this.evidenceFilterToggle.checked = false;

      if (this.responseDate !== "") this.setResponseDate(this.responseDate);
      this.setResponse(this.response);

      this.#switchTab("response", "LeftArea");
      this.#refreshContainer();
    }
  }

  setResponse(responseText) {
    if (!responseText) return;

    this.response = responseText;
    this.responseTextContainer.style.fontWeight = "normal"; // ✅ Ensure normal font
    this.responseTextContainer.innerHTML = `<strong>${this.#lt("response")}:</strong> <span style="font-weight: normal;">${responseText}</span>`;
  }

  setResponseDate(date) {
    this.responseDate = date;

    if (this.responseDateContainer) {
      this.responseDateContainer.innerHTML = `<strong>${this.#lt("response_date")}:</strong> <span style="font-weight: normal;">${date}</span>`;
    }

    if (this.searchResponseDateContainer) {
      this.searchResponseDateContainer.innerHTML = `<strong>${this.#lt("response_date")}:</strong> <span style="font-weight: normal;">${date}</span>`;
    }

    // 🔹 Only show the response date checkbox if there's NO question date
    if (!this.questionDate && this.searchDateCheckboxResponse) {
      this.searchDateCheckboxResponse.style.display = "inline-block";
      this.searchWithDate = this.searchDateCheckboxResponse.checked; // ✅ Track selection
    }
  }

  #refreshResponsePanel() {
    this.responsePanel.style.display =
      this.mode === "response" || this.mode === "edit" ? "block" : "none";
    this.responseTextContainer.innerHTML = "";

    const containerResponse = this.response;

    if (!this.claims || this.claims.length === 0) {
      this.responseTextContainer.textContent = containerResponse;
      return;
    }

    const activeSelections =
      this.selectedClaimIndex === null
        ? this.claims.flatMap((claim) => claim.selections)
        : this.claims[this.selectedClaimIndex]?.selections || [];

    const positionMap = Array.from(
      { length: containerResponse.length },
      () => [],
    );
    this.claims.forEach((claim, claimIndex) => {
      claim.selections.forEach(({ range }) => {
        for (let i = range.startOffset; i < range.endOffset; i++) {
          positionMap[i].push(claimIndex);
        }
      });
    });

    let segmentStart = 0;
    let currentClaims = [];

    for (let i = 0; i <= containerResponse.length; i++) {
      const claimsAtPosition = positionMap[i] || [];

      if (
        i === containerResponse.length ||
        claimsAtPosition.toString() !== currentClaims.toString()
      ) {
        if (segmentStart < i) {
          const responseSegment = containerResponse.slice(segmentStart, i);
          const span = document.createElement("span");
          span.textContent = responseSegment;

          if (currentClaims.length > 0) {
            if (this.selectedClaimIndex === null) {
              if (currentClaims.length === 1) {
                const baseColor =
                  this.colors[currentClaims[0] % this.colors.length];
                const lighterColor = this.#lightenColor(baseColor);
                span.style.backgroundColor = lighterColor;
                if (
                  this.displayCoreClaims &&
                  this.claims[currentClaims[0]].core === true
                ) {
                  span.style.border = "1px solid black";
                }
                if (this.displayCoreClaims) {
                  span.style.cursor = "pointer";
                  span.dataset.claimIndex = currentClaims[0];
                  span.addEventListener("click", (e) =>
                    this.#toggleClaimCore(
                      parseInt(e.target.dataset.claimIndex),
                    ),
                  );
                }
              } else {
                span.style.backgroundColor = this.intersectionColor;
              }
            } else if (currentClaims.includes(this.selectedClaimIndex)) {
              const baseColor =
                this.colors[this.selectedClaimIndex % this.colors.length];
              const lighterColor = this.#lightenColor(baseColor);
              span.style.backgroundColor = lighterColor;
            }
            span.style.color = "#000";
          } else {
            span.classList.add("non-claim");

            if (this.selectedClaimIndex !== null) {
              let includeAdjacent = false;

              if (
                segmentStart > 0 &&
                positionMap[segmentStart - 1]?.includes(this.selectedClaimIndex)
              ) {
                includeAdjacent = true;
              }
              if (
                i < containerResponse.length &&
                positionMap[i]?.includes(this.selectedClaimIndex)
              ) {
                includeAdjacent = true;
              }

              if (!includeAdjacent) {
                span.style.display = "none";
              }
            }
          }

          this.responseTextContainer.appendChild(span);
        }
        segmentStart = i;
        currentClaims = claimsAtPosition;
      }
    }
  }

  #toggleClaimCore(claimIndex) {
    if (!this.displayCoreClaims) return;
    if (
      claimIndex == null ||
      claimIndex < 0 ||
      claimIndex >= this.claims.length
    )
      return;
    this.claims[claimIndex].core = !this.claims[claimIndex].core;
    this.#markUnsaved();
    this.#refreshContainer();
  }
  //#endregion

  //#region SEARCH PANEL

  #createSearchPanel(parentContainer) {
    this.searchPanel = document.createElement("div");
    this.searchPanel.classList.add("search-panel");
    this.#applyPanelStyles(this.searchPanel);

    // ✅ Prompt Section (Question, Question Date, Response Date)
    this.searchPromptContainer = document.createElement("div");
    this.#applyPromptContainerStyles(this.searchPromptContainer);

    this.searchQuestionTextContainer = document.createElement("div");
    this.searchQuestionDateContainer = document.createElement("div");
    this.searchResponseDateContainer = document.createElement("div");

    this.#applyLabelValueStyles(this.searchQuestionTextContainer);
    this.#applyLabelValueStyles(this.searchQuestionDateContainer);
    this.#applyLabelValueStyles(this.searchResponseDateContainer);

    // 🔹 Create two checkboxes (Initially Hidden)
    this.searchDateCheckboxQuestion = document.createElement("input");
    this.searchDateCheckboxQuestion.type = "checkbox";
    this.searchDateCheckboxQuestion.checked = false; // ✅ Default unchecked
    this.searchDateCheckboxQuestion.style.marginRight = "5px";
    this.searchDateCheckboxQuestion.style.display = "none"; // 🔹 Initially Hidden
    this.searchDateCheckboxQuestion.addEventListener("change", () => {
      this.searchWithDate = this.searchDateCheckboxQuestion.checked;
    });

    this.searchDateCheckboxResponse = document.createElement("input");
    this.searchDateCheckboxResponse.type = "checkbox";
    this.searchDateCheckboxResponse.checked = false; // ✅ Default unchecked
    this.searchDateCheckboxResponse.style.marginRight = "5px";
    this.searchDateCheckboxResponse.style.display = "none"; // 🔹 Initially Hidden
    this.searchDateCheckboxResponse.addEventListener("change", () => {
      this.searchWithDate = this.searchDateCheckboxResponse.checked;
    });

    // 🔹 Wrap them to ensure alignment
    this.searchQuestionDateWrapper = document.createElement("div");
    this.searchQuestionDateWrapper.style.display = "flex";
    this.searchQuestionDateWrapper.style.alignItems = "center";
    this.searchQuestionDateWrapper.appendChild(this.searchDateCheckboxQuestion);
    this.searchQuestionDateWrapper.appendChild(
      this.searchQuestionDateContainer,
    );

    this.searchResponseDateWrapper = document.createElement("div");
    this.searchResponseDateWrapper.style.display = "flex";
    this.searchResponseDateWrapper.style.alignItems = "center";
    this.searchResponseDateWrapper.appendChild(this.searchDateCheckboxResponse);
    this.searchResponseDateWrapper.appendChild(
      this.searchResponseDateContainer,
    );

    // ✅ Add to UI
    this.searchPromptContainer.appendChild(this.searchQuestionTextContainer);
    this.searchPromptContainer.appendChild(this.searchQuestionDateWrapper);
    this.searchPromptContainer.appendChild(this.searchResponseDateWrapper);
    this.searchPanel.appendChild(this.searchPromptContainer); // ✅ Add Prompt Section

    // ✅ Search Input Field
    this.searchInputWrapper = document.createElement("div");
    this.#applyInputWrapperStyles(this.searchInputWrapper);

    this.searchInput = document.createElement("textarea");
    this.#applySearchInputStyles(this.searchInput);
    this.searchInput.placeholder = this.#it("enter_search_query");

    this.searchInput.addEventListener("input", () =>
      this.#toggleSearchButton(true),
    );
    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.#handleSearch();
      }
    });

    this.searchInputWrapper.appendChild(this.searchInput);

    // ✅ Search Button
    const searchPanelButton = document.createElement("button");
    searchPanelButton.textContent = this.#bt("search");
    this.#applySearchButtonStyles(searchPanelButton);
    searchPanelButton.style.display = "none"; // Initially hidden

    searchPanelButton.addEventListener("click", () => {
      this.#handleSearch();
      this.#toggleSearchButton(false);
    });

    this.searchInputWrapper.appendChild(searchPanelButton);
    this.searchPanel.appendChild(this.searchInputWrapper);

    // ✅ Search Results Container
    this.searchContainer = document.createElement("div");
    this.#applySearchContainerStyles(this.searchContainer);

    this.searchResultContainer = document.createElement("div");
    this.#applySearchResultContainerStyles(this.searchResultContainer);

    this.searchContainer.appendChild(this.searchResultContainer);
    this.searchPanel.appendChild(this.searchContainer);

    parentContainer.appendChild(this.searchPanel);
    return this.searchPanel;
  }

  #toggleSearchButton(show) {
    const searchPanelButton = this.searchPanel?.querySelector("button"); // ✅ Ensure correct button
    if (searchPanelButton) {
      searchPanelButton.style.display = show ? "inline-block" : "none";
    }
  }

  setSearchResults(results) {
    this.searchResultContainer.innerHTML = ""; // Clear previous results

    if (typeof results === "string") {
      this.searchResultContainer.innerHTML = `<p>${results}</p>`;
      return;
    }

    // Extract domain from URL
    function extractDomain(url) {
      try {
        let hostname = new URL(url).hostname;
        return hostname.replace("www.", ""); // Remove 'www.'
      } catch (e) {
        return "Unknown"; // Fallback if URL is malformed
      }
    }

    results.forEach((result) => {
      let resultItem = document.createElement("div");
      resultItem.style.marginBottom = "15px";
      resultItem.style.padding = "8px";
      resultItem.style.borderBottom = "1px solid #ddd";
      resultItem.style.fontFamily = "inherit"; // ✅ Force same font as claims/evidence
      resultItem.style.fontSize = "inherit"; // ✅ Inherit global size

      // Title with hyperlink
      let titleLink = document.createElement("a");
      titleLink.href = result.link;
      titleLink.textContent = result.title;
      titleLink.target = "_blank";
      titleLink.style.display = "block";
      titleLink.style.fontWeight = "bold"; // ✅ Matches Evidence/Claim Titles
      titleLink.style.textDecoration = "none";
      titleLink.style.color = "#007bff"; // ✅ Titles are now BLACK instead of blue
      titleLink.style.fontSize = "inherit"; // ✅ Ensure font matches surrounding text

      // Website domain
      let websiteName = document.createElement("span");
      websiteName.textContent = extractDomain(result.link);
      websiteName.style.fontSize = "11px";
      websiteName.style.color = "#666";
      websiteName.style.display = "block";
      websiteName.style.marginTop = "-5px"; // Adjust spacing

      // Snippet text
      let snippetText = document.createElement("p");
      snippetText.textContent = result.snippet;
      snippetText.style.fontSize = "inherit"; // ✅ Force same font as evidence/claims
      snippetText.style.color = "inherit"; // ✅ Match surrounding text color
      snippetText.style.marginTop = "5px";

      resultItem.appendChild(titleLink);
      resultItem.appendChild(websiteName);
      resultItem.appendChild(snippetText);
      this.searchResultContainer.appendChild(resultItem);
    });

    this.searchResultContainer.style.display = "block";
  }

  //#endregion

  //#region CLAIMS PANEL

  #createSmallButton(label, handler, backgroundColor = "#fff") {
    const button = document.createElement("button");
    button.textContent = label;
    button.classList.add("menu-button");
    button.style.backgroundColor = backgroundColor;
    button.addEventListener("click", handler);
    return button;
  }

  #createClaimTitleContainer() {
    this.claimTitleContainer = document.createElement("div");
    this.claimTitleContainer.classList.add("claim-title-container");

    this.claimTitleContainer.style.display = "flex";
    this.claimTitleContainer.style.alignItems = "center";
    this.claimTitleContainer.style.width = "100%";
    this.claimTitleContainer.style.padding = "5px 10px";
    this.claimTitleContainer.style.fontSize = "14px";
    this.claimTitleContainer.style.fontWeight = "bold";
    this.claimTitleContainer.style.backgroundColor = "#f9f9f9";
    this.claimTitleContainer.style.borderBottom = "1px solid #ccc";

    const headerContainer = document.createElement("div");
    headerContainer.innerText = this.#lt("claims");
    headerContainer.style.flexGrow = "1";
    headerContainer.style.fontSize = "16px";
    headerContainer.style.fontWeight = "bold";
    headerContainer.style.textAlign = "center";
    this.#addHelp(headerContainer, this.#ht("claims"));
    this.claimTitleContainer.appendChild(headerContainer);

    if (this.displayCoreClaims) {
      this.coreToggleElement = document.createElement("div");
      this.coreToggleElement.style.cssText = `
					width: 80px;
					height: 30px;
					border-radius: 15px;
					background-color: "#e0a0a0;
					color: white;
					display: flex;
					align-items: center;
					justify-content: center;
					font-weight: bold;
					font-size: 14px;
					user-select: none;
					pointer-events: none;
					font-family: Arial, sans-serif;
			`;
      this.coreToggleElement.textContent = "Core";
      this.claimTitleContainer.appendChild(this.coreToggleElement);
    }

    this.middleContainer.appendChild(this.claimTitleContainer);
  }

  #createClaimsMessageContainer() {
    this.claimsMessageContainer = document.createElement("div");
    this.claimsMessageContainer.id = "claims-message-container";
    this.claimsMessageContainer.style.cssText = `
			width: 100%;
			text-align: center;
			font-size: 14px; /* ✅ Uniform size */
			font-weight: normal; /* ✅ Not bold */
			color: red; /* ✅ Consistent red */
			padding: 5px;
			display: none;
			border-bottom: 1px solid #ddd;
		`;
    this.middleContainer.appendChild(this.claimsMessageContainer);
  }

  #createClaimButtonsContainer() {
    this.claimButtonsContainer = document.createElement("div");
    this.claimButtonsContainer.classList.add("claim-buttons-container");

    this.claimButtonsContainer.style.cssText = `
			display: flex;
			gap: 2.5px;
			flex-wrap: wrap;
			width: 100%;
			padding: 3px 5px;
			border-bottom: 1px solid #ccc;
		`;

    this.middleContainer.appendChild(this.claimButtonsContainer);
  }

  #createClaimButtons() {
    if (!this.claimButtonsContainer) {
      console.error(
        "❌ claimButtonsContainer is not initialized before createClaimButtons()",
      );
      return;
    }

    this.claimButtonsContainer.innerHTML = ""; // Clear previous buttons

    // 🔹 "All" button to show all claims
    const allButton = this.#createSmallButton("All", () => {
      this.selectedClaimIndex = null;
      this.#refreshContainer();

      // 🔹 NEW: If Evidence Filter is ON, refresh the evidence panel
      if (this.evidenceFilterToggle.checked) {
        this.#refreshEvidenceContainer();
      }
    });

    allButton.style.backgroundColor =
      this.selectedClaimIndex === null ? "#007bff" : "#fff";
    allButton.style.color =
      this.selectedClaimIndex === null ? "white" : "#007bff";
    allButton.style.transform = "scale(0.98)";
    allButton.style.margin = "1.5px";
    allButton.style.padding = "5px 10px";
    allButton.style.display = "inline-flex";
    allButton.style.alignItems = "center";
    allButton.style.justifyContent = "center";
    this.claimButtonsContainer.appendChild(allButton);

    this.claims.forEach((_, index) => {
      const claimButton = this.#createSmallButton(`${index + 1}`, () => {
        this.selectedClaimIndex = index;
        this.#refreshContainer();

        // 🔹 NEW: If Evidence Filter is ON, refresh the evidence panel
        if (this.evidenceFilterToggle.checked) {
          this.#refreshEvidenceContainer();
        }
      });

      const baseColor = this.colors[index % this.colors.length];
      const lighterColor = this.#lightenColor(baseColor);

      claimButton.style.backgroundColor =
        this.selectedClaimIndex === index
          ? `rgb(${baseColor.join(",")})`
          : lighterColor;
      claimButton.style.color = "black";

      claimButton.style.transform = "scale(0.98)";
      claimButton.style.margin = "1.5px";
      claimButton.style.padding = "5px 10px";
      claimButton.style.display = "inline-flex";
      claimButton.style.alignItems = "center";
      claimButton.style.justifyContent = "center";

      this.claimButtonsContainer.appendChild(claimButton);
    });
  }

  #createClaimsContainer() {
    if (this.claimsContainer) return; // Avoid duplicate creation
    this.claimsContainer = document.createElement("div");
    this.claimsContainer.classList.add("claims-container");

    // ✅ Ensure scroll works properly
    this.claimsContainer.style.cssText = `
			overflow-y: auto;  /* ✅ Enable scrolling */
			flex-grow: 1; /* ✅ Take available space */
			max-height: 100%; /* ✅ Prevent cutting off last claim */
		`;

    this.middleContainer.appendChild(this.claimsContainer);
  }

  #refreshClaimsContainer() {
    if (!this.claimsContainer) {
      console.error(
        "❌ claimsContainer is not initialized before refreshClaimsContainer()",
      );
      return;
    }
    this.middleContainer.style.display = this.annotationStatus.stopped
      ? "none"
      : "block";
    if (this.annotationStatus.stopped) return; // Stop rendering if hidden

    this.claimTitleContainer.style.backgroundColor = this.annotationStatus
      .claims.complete
      ? "#a0e0a0"
      : "#f9f9f9";
    this.claimsContainer.innerHTML = "";

    if (this.claims.length === 0) {
      if (this.displayCoreClaims && this.coreToggleElement) {
        this.coreToggleElement.style.backgroundColor = "#e0a0a0";
      }
      return;
    }

    if (this.displayCoreClaims && this.coreToggleElement) {
      const hasCore = this.claims.some((c) => c.core === true);
      this.coreToggleElement.style.backgroundColor = hasCore
        ? "#a0e0a0"
        : "#e0a0a0";
    }

    if (
      this.selectedClaimIndex !== null &&
      (this.selectedClaimIndex < 0 ||
        this.selectedClaimIndex >= this.claims.length)
    ) {
      console.warn("⚠️ selectedClaimIndex out of bounds, resetting to null.");
      this.selectedClaimIndex = null;
    }

    const claimsToDisplay =
      this.selectedClaimIndex === null
        ? this.claims
        : [this.claims[this.selectedClaimIndex]];

    claimsToDisplay.forEach((claim, displayIndex) => {
      const actualClaimIndex =
        this.selectedClaimIndex === null
          ? displayIndex
          : this.selectedClaimIndex;
      const baseColor = this.colors[actualClaimIndex % this.colors.length];
      const lighterColor = this.#lightenColor(baseColor);

      const claimDiv = document.createElement("div");
      claimDiv.style.cssText = `
            border: 1px solid #ccc;
            padding: 10px;
            margin-bottom: 5px;
            background-color: #f9f9f9;
            position: relative;
            font-family: Arial, sans-serif;
            font-size: 14px;
            white-space: pre-wrap;
            display: flex;
            flex-direction: column;
        `;

      const topRow = document.createElement("div");
      topRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 5px;
            border-bottom: 1px solid #ddd;
        `;

      const claimNumberContainer = document.createElement("div");
      claimNumberContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 5px;
        `;

      if (this.mode === "search") {
        const searchButton = document.createElement("button");
        searchButton.textContent = "◀";
        searchButton.style.cssText = `
                background: none;
                border: none;
                color: blue;
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                margin: 0;
                width: 16px;
                text-align: center;
            `;

        searchButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this.#handleSearchClaim(actualClaimIndex);
        });

        claimNumberContainer.appendChild(searchButton);
      }

      const claimNumber = document.createElement("span");
      claimNumber.textContent = `${actualClaimIndex + 1}.`;
      claimNumber.style.cssText = `
            color: blue;
            font-weight: bold;
            flex: 0 0 auto;
            text-align: left;
        `;

      claimNumberContainer.appendChild(claimNumber);
      topRow.appendChild(claimNumberContainer);

      if (this.mode === "response") {
        const deleteButton = this.#createDeleteButton((event) => {
          event.stopPropagation();
          this.#removeClaim(actualClaimIndex);
        });

        const deleteButtonContainer = document.createElement("div");
        deleteButtonContainer.style.cssText = `
                margin-left: auto;
                align-self: flex-start;
            `;
        deleteButtonContainer.appendChild(deleteButton);
        topRow.appendChild(deleteButtonContainer);
      }

      claimDiv.appendChild(topRow);

      const highlightedText = document.createElement("div");
      highlightedText.style.cssText = `
            margin-top: 5px;
            line-height: 1.4;
            display: flex;
            align-items: center;
            width: 100%;
        `;

      const spanContainer = document.createElement("span");
      spanContainer.style.cssText = `display: inline;`;

      claim.selections.forEach((selection) => {
        const span = document.createElement("span");
        span.textContent = selection.text;
        span.style.cssText = `
                background-color: ${lighterColor};
                padding: 2px 4px;
            `;
        spanContainer.appendChild(span);
      });

      highlightedText.appendChild(spanContainer);
      claimDiv.appendChild(highlightedText);

      if (this.evidences.length > 0) {
        const evidenceContainer = document.createElement("div");
        evidenceContainer.style.cssText = `
                margin-top: 5px;
                display: flex;
                flex-direction: column;
                gap: 5px;
                font-size: 12px;
            `;

        const evidenceRow = document.createElement("div");
        evidenceRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 5px;
            `;

        const evidenceLabel = document.createElement("span");
        evidenceLabel.textContent = this.#lt("matched_evidences");
        evidenceLabel.style.fontWeight = "bold";

        const evidenceButtonsContainer = document.createElement("div");
        evidenceButtonsContainer.style.cssText = `
                display: flex;
                gap: 2.5px;
                flex-wrap: wrap;
                width: 100%;
                padding: 3px 5px;
                border-bottom: 1px solid #ccc;
            `;

        this.evidences.forEach((_, evidenceIndex) => {
          const button = this.#createSmallButton(
            this.#getEvidenceLabel(evidenceIndex),
            () => {
              const oldState = claim.grounding ?? null; // 🔵 Fix: capture old grounding

              let userSelection =
                claim.groundingEvidences?.[evidenceIndex] ?? null;
              userSelection =
                userSelection === null
                  ? true
                  : userSelection === true
                    ? false
                    : null;

              if (!this.claims[actualClaimIndex].groundingEvidences) {
                this.claims[actualClaimIndex].groundingEvidences = {};
              }

              if (userSelection === null) {
                delete this.claims[actualClaimIndex].groundingEvidences[
                  evidenceIndex
                ]; // 🔵 Fix: delete if null
              } else {
                this.claims[actualClaimIndex].groundingEvidences[
                  evidenceIndex
                ] = userSelection;
              }

              this.#setEvidenceButtonStyle(
                button,
                userSelection,
                this.matches.find(
                  (m) =>
                    m.claim === actualClaimIndex &&
                    m.evidence === evidenceIndex,
                )?.grounding ?? null,
              );
              this.#markUnsaved();

              const updateMatchedToggle = () => {
                let hasTrue = false,
                  hasFalse = false;

                this.evidences.forEach((_, evidenceIndex) => {
                  const sel =
                    this.claims[actualClaimIndex].groundingEvidences?.[
                      evidenceIndex
                    ];
                  if (sel === true) hasTrue = true;
                  if (sel === false) hasFalse = true;
                });

                const newState =
                  hasTrue && !hasFalse
                    ? true
                    : hasFalse && !hasTrue
                      ? false
                      : null;

                if (
                  claim.matchedToggleManager &&
                  typeof claim.matchedToggleManager.setToggleValue ===
                    "function"
                ) {
                  claim.matchedToggleManager.setToggleValue("", newState);
                }

                claim.grounding = newState;

                if (newState !== false) {
                  claim.criticality = null;
                }

                return newState;
              };

              const newState = updateMatchedToggle();

              if (newState != oldState) {
                const hasIncorrectClaims = this.claims.some(
                  (claim) => claim.grounding === false,
                );

                this.responseToggleManager.setToggleFieldValues({
                  responseIndex: this.currentResponseIndex,
                  values: this.responseFieldValues,
                  conditions: { onIncorrectClaims: hasIncorrectClaims },
                });
              }

              this.#refreshClaimsContainer();
            },
          );

          let userSelection = claim.groundingEvidences?.[evidenceIndex] ?? null;
          this.#setEvidenceButtonStyle(
            button,
            userSelection,
            this.matches.find(
              (m) =>
                m.claim === actualClaimIndex && m.evidence === evidenceIndex,
            )?.grounding ?? null,
          );

          button.style.cssText = `
                    align-items: center;
                    background-color: ${button.style.backgroundColor}; 
                    border-radius: 4px;
                    box-shadow: rgba(0, 0, 0, 0.15) 0px 1px 2px 0px;
                    box-sizing: border-box;
                    color: black;
                    cursor: pointer;
                    display: flex;
                    font-family: "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
                    font-size: 16px;
                    font-weight: 600;
                    height: 34px;
                    justify-content: center;
                    margin: 1.5px;
                    padding: 5px 10px;
                    text-align: center;
                    transition: box-shadow 0.15s ease;
                    width: 36px;
                    transform: scale(0.98);
                `;

          evidenceButtonsContainer.appendChild(button);
        });

        evidenceRow.appendChild(evidenceLabel);
        evidenceRow.appendChild(evidenceButtonsContainer);
        evidenceContainer.appendChild(evidenceRow);
        claimDiv.appendChild(evidenceContainer);
      }

      if (this.invalidClaimField && claim.grounding === false) {
        const invalidToggleRow = document.createElement("div");
        invalidToggleRow.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: flex-start;
                padding: 5px 10px;
                font-size: 12px;
            `;

        const criticalityValue = claim.criticality ?? null;

        const criticalityToggleField = Object.assign(
          {
            label: "Criticality",
            value: criticalityValue,
            alignment: "left",
            labelColor: "black",
          },
          this.invalidClaimField,
        );

        let criticalityToggleManager;

        criticalityToggleManager = new ToggleManager({
          container: invalidToggleRow,
          toggleFields: [criticalityToggleField],
          helperManager: this.helperManager,
          textManager: this.textManager,
          onUpdate: (isUserAction) => {
            if (!criticalityToggleManager) {
              console.warn(
                "⚠️ `criticalityToggleManager` is not initialized yet.",
              );
              return;
            }

            const toggles = criticalityToggleManager.getToggleFieldValues();
            const criticalityField = toggles.find(
              (field) => field.labelKey === this.invalidClaimField?.labelKey,
            );
            claim.criticality = criticalityField?.value ?? null;
            if (isUserAction) this.#markUnsaved();
          },
        });

        claimDiv.appendChild(invalidToggleRow);
      }

      if (this.isClaimComments && this.evidences.length > 0) {
        const commentContainer = document.createElement("div");
        commentContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                padding: 5px 10px;
                font-size: 12px;
                background: #f9f9f9;
                border-top: 1px solid #ddd;
            `;

        if (
          this.isClaimComments &&
          typeof this.claimComments === "object" &&
          this.claimComments.labelKey
        ) {
          const commentLabel = document.createElement("span");
          commentLabel.textContent =
            this.#t(this.claimComments.labelKey) || "Comment";
          commentLabel.style.fontWeight = "bold";
          commentLabel.style.marginBottom = "3px";
          commentLabel.style.display = "block";
          commentContainer.appendChild(commentLabel);
        }

        const commentInput = document.createElement("textarea");
        commentInput.value = claim.comment || "";
        commentInput.style.cssText = `
                width: 100%;
                padding: 5px;
                font-size: 12px;
                font-family: Arial, sans-serif;
                border: 1px solid #ccc;
                border-radius: 4px;
                background: white;
                resize: vertical;
            `;

      commentInput.addEventListener("input", () => {
        claim.comment = commentInput.value;
        this.#markUnsaved();
      });

        commentContainer.appendChild(commentInput);
        claimDiv.appendChild(commentContainer);
      }

      this.claimsContainer.appendChild(claimDiv);
    });

    this.#updateFilterToggleVisibility();
  }

  #setEvidenceButtonStyle(button, userSelection, machineGrounding) {
    button.style.color = "white";

    if (userSelection === true) {
      button.style.backgroundColor = "rgb(40, 167, 69)"; // 🔹 Fixed Green (Corrected)
    } else if (userSelection === false) {
      button.style.backgroundColor = "rgb(220, 53, 69)"; // 🔹 Fixed Red (Corrected)
    } else {
      if (machineGrounding === true) {
        button.style.backgroundColor = "#b5e5c1"; // ✅ Light green (suggested match)
      } else if (machineGrounding === false) {
        button.style.backgroundColor = "#f5b5b5"; // ✅ Light red (suggested contradiction)
      } else {
        button.style.backgroundColor = "#cccccc"; // ✅ Grey (no match)
      }
    }
  }

  //#endregion

  //#region EVIDENCES PANEL

  #createEvidenceTitleContainer() {
    this.evidenceTitleContainer = document.createElement("div");
    this.evidenceTitleContainer.classList.add("evidence-title-container");

    this.evidenceTitleContainer.style.display = "flex";
    this.evidenceTitleContainer.style.alignItems = "center";
    this.evidenceTitleContainer.style.width = "100%";
    this.evidenceTitleContainer.style.padding = "5px 10px";
    this.evidenceTitleContainer.style.fontSize = "14px";
    this.evidenceTitleContainer.style.fontWeight = "bold";
    this.evidenceTitleContainer.style.backgroundColor = "#f9f9f9";
    this.evidenceTitleContainer.style.borderBottom = "1px solid #ccc";

    // 🔹 Title (Centered)
    const headerContainer = document.createElement("div");
    headerContainer.innerText = this.#lt("evidences");
    headerContainer.style.fontSize = "16px";
    headerContainer.style.fontWeight = "bold";
    headerContainer.style.flexGrow = "1";
    headerContainer.style.textAlign = "center";
    this.#addHelp(headerContainer, this.#ht("evidences"));

    // 🔹 Filter Container (Right-Aligned)
    this.evidenceFilterContainer = document.createElement("div");
    this.evidenceFilterContainer.style.display = "flex";
    this.evidenceFilterContainer.style.alignItems = "center";
    this.evidenceFilterContainer.style.visibility = "hidden"; // ✅ Start hidden

    const filterText = document.createElement("span");
    filterText.innerText = this.#lt("filter_evidences");
    this.evidenceFilterToggle = document.createElement("input");
    this.evidenceFilterToggle.type = "checkbox";
    this.evidenceFilterToggle.title = "Filter";
    this.evidenceFilterToggle.style.marginLeft = "5px";

    // ✅ Attach Event Listener with Correct `this` Binding
    this.evidenceFilterToggle.addEventListener(
      "change",
      this.#handleEvidenceFilterToggle.bind(this),
    );
    this.evidenceFilterContainer.appendChild(filterText);
    this.evidenceFilterContainer.appendChild(this.evidenceFilterToggle);

    // ✅ Keep structure clean
    this.evidenceTitleContainer.appendChild(headerContainer);
    this.evidenceTitleContainer.appendChild(this.evidenceFilterContainer);
    this.rightContainer.appendChild(this.evidenceTitleContainer);
  }

  #createEvidencesMessageContainer() {
    this.evidenceMessageContainer = document.createElement("div");
    this.evidenceMessageContainer.id = "evidence-message-container";
    this.evidenceMessageContainer.style.cssText = `
			width: 100%;
			text-align: center;
			font-size: 14px; /* ✅ Uniform size */
			font-weight: normal; /* ✅ Not bold */
			color: red; /* ✅ Consistent red */
			padding: 5px;
			display: none;
			border-bottom: 1px solid #ddd;
		`;
    this.rightContainer.appendChild(this.evidenceMessageContainer);
  }

  #createEvidenceButtonsContainer() {
    this.evidenceButtonsContainer = document.createElement("div");
    this.evidenceButtonsContainer.classList.add("evidence-buttons-container");

    this.evidenceButtonsContainer.style.display = "flex";
    this.evidenceButtonsContainer.style.gap = "2.5px";
    this.evidenceButtonsContainer.style.flexWrap = "wrap";
    this.evidenceButtonsContainer.style.width = "100%";
    this.evidenceButtonsContainer.style.padding = "3px 5px";
    this.evidenceButtonsContainer.style.borderBottom = "1px solid #ccc";

    this.rightContainer.appendChild(this.evidenceButtonsContainer);
  }

  #refreshEvidenceButtons() {
    if (!this.evidenceButtonsContainer) {
      console.error(
        "❌ evidenceButtonsContainer is not initialized before refreshEvidenceButtons()",
      );
      return;
    }
    this.rightContainer.style.display = this.annotationStatus.stopped
      ? "none"
      : "block";
    if (this.annotationStatus.stopped) return; // Stop rendering if hidden

    this.evidenceButtonsContainer.innerHTML = ""; // Clear previous buttons

    // 🔹 Create "All" button
    const allButton = this.#createSmallButton("All", () => {
      this.selectedEvidenceIndex = null;
      this.#refreshEvidenceContainer();
    });

    allButton.style.backgroundColor =
      this.selectedEvidenceIndex === null ? "#007bff" : "#fff";
    allButton.style.color =
      this.selectedEvidenceIndex === null ? "white" : "#007bff";
    allButton.style.transform = "scale(0.98)";
    allButton.style.margin = "1.5px";
    allButton.style.padding = "5px 10px";
    allButton.style.display = "inline-flex";
    allButton.style.alignItems = "center";
    allButton.style.justifyContent = "center";

    // ✅ Append buttons in correct order
    this.evidenceButtonsContainer.appendChild(allButton);

    let evidenceIndicesToDisplay = this.evidences.map((_, index) => index); // Default: show all

    // 🔹 Apply filtering if the Evidence Filter toggle is ON
    if (this.evidenceFilterToggle.checked) {
      if (this.selectedClaimIndex !== null) {
        evidenceIndicesToDisplay = this.matches
          .filter((match) => match.claim === this.selectedClaimIndex)
          .map((match) => match.evidence);
      } else {
        evidenceIndicesToDisplay = [
          ...new Set(this.matches.map((match) => match.evidence)),
        ];
      }
    }

    // ✅ Create buttons only for the filtered evidences
    evidenceIndicesToDisplay.forEach((index) => {
      const evidenceButton = this.#createSmallButton(
        this.#getEvidenceLabel(index),
        () => {
          this.selectedEvidenceIndex = index;
          this.#refreshEvidenceContainer();
        },
      );

      evidenceButton.style.backgroundColor =
        this.selectedEvidenceIndex === index ? "#007bff" : "#fff";
      evidenceButton.style.color =
        this.selectedEvidenceIndex === index ? "white" : "#007bff";
      evidenceButton.style.transform = "scale(0.98)";
      evidenceButton.style.margin = "1.5px";
      evidenceButton.style.padding = "5px 10px";
      evidenceButton.style.display = "inline-flex";
      evidenceButton.style.alignItems = "center";
      evidenceButton.style.justifyContent = "center";
      evidenceButton.style.width = "36px";
      this.evidenceButtonsContainer.appendChild(evidenceButton);
    });
  }
  v;
  #createEvidenceContainer() {
    if (this.evidenceContainer) return;
    this.evidenceContainer = document.createElement("div");
    this.evidenceContainer.classList.add("evidence-container");

    // ✅ Enable scrolling
    this.evidenceContainer.style.cssText = `
			overflow-y: auto;
			flex-grow: 1;
			max-height: 100%;
		`;

    this.rightContainer.appendChild(this.evidenceContainer);
  }

  #refreshEvidenceContainer() {
    if (!this.evidenceContainer) {
      console.error(
        "❌ evidenceContainer is not initialized before refreshEvidenceContainer()",
      );
      return;
    }

    this.evidenceTitleContainer.style.backgroundColor = this.annotationStatus
      .evidences.complete
      ? "#a0e0a0"
      : "#f9f9f9";

    this.#refreshEvidenceButtons();
    this.evidenceContainer.innerHTML = ""; // Clear content

    let evidencesToDisplay = this.evidences; // Default: Show all evidences
    let filteredIndices = this.evidences.map((_, index) => index); // Keep track of original indices

    if (this.selectedEvidenceIndex !== null) {
      filteredIndices = [this.selectedEvidenceIndex]; // Show only the selected evidence
    } else if (this.evidenceFilterToggle.checked) {
      if (this.selectedClaimIndex !== null) {
        filteredIndices = this.matches
          .filter(
            (match) =>
              match.claim === this.selectedClaimIndex &&
              match.evidence !== null,
          )
          .map((match) => match.evidence);
      } else {
        filteredIndices = [
          ...new Set(
            this.matches
              .map((match) => match.evidence)
              .filter((e) => e !== null),
          ),
        ];
      }
    }

    evidencesToDisplay = this.evidences.filter((_, index) =>
      filteredIndices.includes(index),
    );

    evidencesToDisplay.forEach((evidence, index) => {
      const actualEvidenceIndex = filteredIndices[index];

      const evidenceDiv = document.createElement("div");
      evidenceDiv.style.cssText = `
        border: 1px solid #ccc;
        padding: 10px;
        margin-bottom: 5px;
        background-color: #f9f9f9;
        font-family: Arial, sans-serif;
        font-size: 14px;
        white-space: pre-wrap;
        cursor: pointer;
        display: flex;
        flex-direction: column;
      `;

      const matchingClaims = this.matches.filter(
        (match) => match.evidence === actualEvidenceIndex,
      );

      let hasTrueMatch = false;
      let hasFalseMatch = false;

      if (this.selectedClaimIndex === null) {
        hasTrueMatch = matchingClaims.some((match) => match.grounding === true);
        hasFalseMatch = matchingClaims.some(
          (match) => match.grounding === false,
        );
      } else {
        hasTrueMatch = matchingClaims.some(
          (match) =>
            match.claim === this.selectedClaimIndex && match.grounding === true,
        );
        hasFalseMatch = matchingClaims.some(
          (match) =>
            match.claim === this.selectedClaimIndex &&
            match.grounding === false,
        );
      }

      let backgroundColor = "#f9f9f9";
      let titleColor = backgroundColor;
      if (hasTrueMatch && hasFalseMatch) {
        titleColor = "#f7e3b5";
      } else if (hasTrueMatch) {
        titleColor = "#d4f7dc";
      } else if (hasFalseMatch) {
        titleColor = "#f7d4d4";
      }

      evidenceDiv.style.backgroundColor = backgroundColor;

      const numberSpan = document.createElement("span");
      numberSpan.textContent = `${this.#getEvidenceLabel(actualEvidenceIndex)}.`;
      numberSpan.style.color = "darkorange";
      numberSpan.style.fontWeight = "bold";

      const domain = new URL(evidence.url).hostname.replace("www.", "");
      const domainLink = document.createElement("a");
      domainLink.href = evidence.url;
      domainLink.target = "_blank";
      domainLink.style.textDecoration = "none";
      domainLink.style.color = "inherit";
      domainLink.style.cursor = "pointer";

      const domainSpan = document.createElement("span");
      domainSpan.textContent = domain;
      domainSpan.style.fontSize = "12px";
      domainSpan.style.fontWeight = "bold";
      domainSpan.style.color = "#666";
      domainSpan.style.textAlign = "center";

      domainLink.appendChild(domainSpan);

      const topRow = document.createElement("div");
      topRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
      `;
      topRow.style.backgroundColor = titleColor;

      const evidenceLeftContainer = document.createElement("div");
      evidenceLeftContainer.style.flex = "0 0 auto";
      evidenceLeftContainer.appendChild(numberSpan);
      topRow.appendChild(evidenceLeftContainer);

      const evidenceMiddleContainer = document.createElement("div");
      evidenceMiddleContainer.style.flex = "1";
      evidenceMiddleContainer.style.textAlign = "center";
      evidenceMiddleContainer.appendChild(domainLink);
      topRow.appendChild(evidenceMiddleContainer);

      if (this.mode === "search") {
        const evidenceRightContainer = document.createElement("div");
        evidenceRightContainer.style.flex = "0 0 auto";
        const deleteButton = this.#createDeleteButton(() => {
          this.#removeEvidence(actualEvidenceIndex);
        });
        evidenceRightContainer.appendChild(deleteButton);
        topRow.appendChild(evidenceRightContainer);
      }

      evidenceDiv.appendChild(topRow);

      const textDiv = document.createElement("span");
      textDiv.style.marginLeft = "5px";
      textDiv.style.textAlign = "left";

      if (this.selectedClaimIndex !== null) {
        let highlightedText = evidence.text;
        const claimMatches = this.matches.filter(
          (match) =>
            match.claim === this.selectedClaimIndex &&
            match.evidence === actualEvidenceIndex,
        );

        claimMatches.forEach((match) => {
          const selections = Array.isArray(match.selections)
            ? match.selections
            : [];
          selections.forEach((selection) => {
            const claimColor =
              this.colors[this.selectedClaimIndex % this.colors.length]; // Match claim color
            const lighterColor = this.#lightenColor(claimColor); // Ensure it's the lighter version as in ClaimsContainer
            const highlightTag = `<span style="background-color: ${lighterColor}; padding: 2px 4px;">${selection}</span>`;
            const regex = new RegExp(
              selection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "gi",
            );
            highlightedText = highlightedText.replace(regex, highlightTag);
          });
        });

        textDiv.innerHTML = highlightedText;
      } else {
        textDiv.textContent = evidence.text;
      }

      evidenceDiv.appendChild(textDiv);
      this.evidenceContainer.appendChild(evidenceDiv);
    });
  }

  #updateFilterToggleVisibility() {
    const hasMatches = this.matches.length > 0;

    if (!this.evidenceFilterToggle) {
      console.error("❌ Evidence Filter Toggle is not initialized.");
      return;
    }

    this.evidenceFilterContainer.style.visibility = hasMatches
      ? "visible"
      : "hidden";
  }

  #handleEvidenceFilterToggle() {
    if (!this.evidenceFilterToggle) {
      console.error("❌ evidenceFilterToggle is undefined! Cannot toggle.");
      return;
    }

    // ✅ Refresh Evidence Panel and Buttons after toggle change
    this.#refreshEvidenceContainer();
  }

  #removeEvidence(evidenceIndex) {
    if (
      evidenceIndex === null ||
      evidenceIndex === undefined ||
      evidenceIndex >= this.evidences.length
    ) {
      console.error("❌ Invalid evidence index for deletion:", evidenceIndex);
      return;
    }

    this.evidences.splice(evidenceIndex, 1);
    this.#markUnsaved();

    if (this.selectedEvidenceIndex === evidenceIndex) {
      if (evidenceIndex >= this.evidences.length) {
        this.selectedEvidenceIndex = null;
      }
    } else if (this.selectedEvidenceIndex > evidenceIndex) {
      this.selectedEvidenceIndex -= 1;
    }

    // 🔵 New: call match/evidence cleanup after deletion
    this.#syncMatchesAfterDeletion(null, evidenceIndex); // 👈 pass evidenceIndex

    // 🔵 New: recompute incorrect claims after deletion
    const hasIncorrectClaims = this.claims.some(
      (claim) => claim.grounding === false,
    );
    this.responseToggleManager.setToggleFieldValues({
      responseIndex: this.currentResponseIndex,
      values: this.responseFieldValues,
      conditions: { onIncorrectClaims: hasIncorrectClaims },
    });

    this.#refreshContainer(); // 🔥 Simplified refresh
  }

  //#endregion

  //#region OTHERS

  #getEvidenceLabel(index) {
    let label = "";
    do {
      label = String.fromCharCode(65 + (index % 26)) + label;
      index = Math.floor(index / 26) - 1;
    } while (index >= 0);
    return label;
  }

  #createDeleteButton(onClickHandler) {
    const deleteButton = document.createElement("button");
    deleteButton.innerHTML = "✖";
    deleteButton.style.cssText = `
			background: #f2f2f2;
			border: none;
			color: #cc0000;
			font-size: 14px;
			cursor: pointer;
			padding: 4px 8px;
			margin: 2px;
			width: 20px;
			height: 20px;
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: 4px;
			transition: background 0.2s, color 0.2s;
		`;

    deleteButton.addEventListener("mouseover", () => {
      deleteButton.style.background = "#e6e6e6";
      deleteButton.style.color = "#990000";
    });

    deleteButton.addEventListener("mouseout", () => {
      deleteButton.style.background = "#f2f2f2";
      deleteButton.style.color = "#cc0000";
    });

    deleteButton.addEventListener("click", onClickHandler);

    return deleteButton;
  }

  #refreshContainer() {
    if (!this.built) {
      return;
    }
    this.#updateAnnotationStatus();
    this.#createClaimButtons();
    this.#refreshContextPanel();
    this.#refreshQuestionPanel();
    this.#refreshResponsePanel();
    this.#refreshClaimsContainer();
    this.#refreshEvidenceContainer();
    this.#refreshActionButtons();
    this.#updateFilterToggleVisibility();
  }

  //#endregion

  //#region EVIDENCE MANAGEMENT

  #handleAddEvidence() {
    if (this.evidenceTextInputContainer) {
      this.evidenceTextInputContainer.remove();
    }

    // Create input for evidence text
    this.evidenceTextInputContainer = document.createElement("div");
    this.evidenceTextInputContainer.style.cssText = `
			position: fixed;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			background: white;
			padding: 20px;
			border: 1px solid #ccc;
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
			z-index: 1000;
			display: flex;
			flex-direction: column;
			align-items: center;
			width: 400px;
		`;

    this.evidenceTextInput = document.createElement("textarea");
    this.evidenceTextInput.placeholder = this.#it("paste_evidence");
    this.evidenceTextInput.style.cssText = `
			width: 100%;
			height: 100px;
			padding: 8px;
			margin-bottom: 10px;
			border: 1px solid #ccc;
			resize: vertical;
		`;

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
			display: flex;
			justify-content: space-between;
			width: 100%;
			margin-top: 10px;
		`;

    const okButton = document.createElement("button");
    okButton.textContent = this.#bt("ok");
    okButton.style.cssText = `
			padding: 8px 16px;
			background-color: #007bff;
			color: white;
			border: none;
			cursor: pointer;
			flex: 1;
			margin-right: 5px;
		`;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = this.#bt("cancel");
    cancelButton.style.cssText = `
			padding: 8px 16px;
			background-color: #ccc;
			color: black;
			border: none;
			cursor: pointer;
			flex: 1;
		`;

    cancelButton.addEventListener("click", () => {
      this.evidenceTextInputContainer.remove();
    });

    okButton.addEventListener("click", () => {
      const copiedText = this.evidenceTextInput.value.trim();
      if (!copiedText) {
        this.#showError(this.#et("no_text_provided"));
        return;
      }

      this.evidenceTextInputContainer.remove();
      this.#askUserForURL(copiedText);
    });

    buttonContainer.appendChild(okButton);
    buttonContainer.appendChild(cancelButton);

    this.evidenceTextInputContainer.appendChild(this.evidenceTextInput);
    this.evidenceTextInputContainer.appendChild(buttonContainer);
    document.body.appendChild(this.evidenceTextInputContainer);

    this.evidenceTextInput.focus();
    this.#updateAnnotationStatus();
  }

  #askUserForURL(copiedText) {
    if (this.evidenceURLInputContainer) {
      this.evidenceURLInputContainer.remove();
    }

    this.evidenceURLInputContainer = document.createElement("div");
    this.evidenceURLInputContainer.style.cssText = `
			position: fixed;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			background: white;
			padding: 20px;
			border: 1px solid #ccc;
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
			z-index: 1000;
			display: flex;
			flex-direction: column;
			align-items: center;
			width: 400px;
		`;

    this.evidenceURLInput = document.createElement("input");
    this.evidenceURLInput.type = "text";
    this.evidenceURLInput.placeholder = this.#it("paste_url");
    this.evidenceURLInput.style.cssText = `
			width: 100%;
			padding: 8px;
			margin-bottom: 10px;
			border: 1px solid #ccc;
		`;

    this.evidenceURLInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        okButton.click();
      }
    });

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
			display: flex;
			justify-content: space-between;
			width: 100%;
			margin-top: 10px;
		`;

    const okButton = document.createElement("button");
    okButton.textContent = this.#bt("ok");
    okButton.style.cssText = `
			padding: 8px 16px;
			background-color: #007bff;
			color: white;
			border: none;
			cursor: pointer;
			flex: 1;
			margin-right: 5px;
		`;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = this.#bt("cancel");
    cancelButton.style.cssText = `
			padding: 8px 16px;
			background-color: #ccc;
			color: black;
			border: none;
			cursor: pointer;
			flex: 1;
		`;

    cancelButton.addEventListener("click", () => {
      this.evidenceURLInputContainer.remove();
    });

    okButton.addEventListener("click", () => {
      const url = this.evidenceURLInput.value.trim();
      if (!this.#isValidURL(url)) {
        this.#showError(this.#et("invalid_url"));
        return;
      }

      this.evidenceURLInputContainer.remove();
      this.evidences.push({ url, text: copiedText });
      this.#markUnsaved();
      this.#refreshContainer(); // 🔥 Simplified refresh
    });

    buttonContainer.appendChild(okButton);
    buttonContainer.appendChild(cancelButton);

    this.evidenceURLInputContainer.appendChild(this.evidenceURLInput);
    this.evidenceURLInputContainer.appendChild(buttonContainer);
    document.body.appendChild(this.evidenceURLInputContainer);

    this.evidenceURLInput.focus();
  }

  #isValidURL(url) {
    const pattern = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;
    return pattern.test(url);
  }

  //#endregion

  //#region BACKEND INTERFACE MANAGEMENT

  async #extractClaims(response) {
    if (!response) return;

    // 🔹 Abort previous request if it exists
    if (this.ongoingRequests.extractClaims.controller) {
      this.ongoingRequests.extractClaims.controller.abort();
    }

    // 🔹 Create controller and requestId
    const controller = new AbortController();
    const requestId = Date.now(); // ✅ Unique ID for this extraction

    // 🔹 Store new request state
    this.ongoingRequests.extractClaims = {
      controller,
      requestId,
      params: response,
    };

    // ✅ NEW: Capture local copy of requestId for safe future checks
    const myRequestId = requestId;

    this.setMessage(this.#it("extracting_claims"), "claims");

    try {
      const extractedClaims = await this.backend.extractClaims(
        response,
        controller.signal,
      );

      // ✅ Abort if request is outdated
      if (this.ongoingRequests.extractClaims.requestId !== myRequestId) {
        console.warn("⚠️ Outdated extractClaims result ignored.");
        return;
      }

      if (!extractedClaims || extractedClaims.error) {
        console.error(
          "❌ Error extracting claims (backend returned invalid):",
          extractedClaims,
        );
        // ✅ NEW: Avoid overwriting user edits if aborted
        if (this.ongoingRequests.extractClaims.controller) {
          this.#showError(this.#et("extracting_issue"), "claims");
          return;
        }
      }

      this.#setClaims(extractedClaims);
    } catch (error) {
      if (controller.signal.aborted) {
        console.warn("⚠️ extractClaims request was aborted.");
      } else {
        console.error("❌ Error extracting claims:", error);
        // ✅ NEW: Avoid overwriting user edits if aborted
        if (this.ongoingRequests.extractClaims.controller) {
          this.#showError(this.#et("extracting_issue"), "claims");
        }
      }
    } finally {
      // ✅ Only reset if still active request
      if (this.ongoingRequests.extractClaims.requestId === myRequestId) {
        this.ongoingRequests.extractClaims.controller = null;
      }
      this.setMessage("", "claims"); // ✅ Always clear extracting message
    }
  }

  #abortExtractClaims() {
    if (this.ongoingRequests.extractClaims.controller) {
      console.warn("⚠️ User action detected. Aborting extractClaims request.");
      this.ongoingRequests.extractClaims.controller.abort();
      this.ongoingRequests.extractClaims.controller = null;
    }

    // ✅ NEW: Invalidate the requestId immediately to prevent any late responses
    this.ongoingRequests.extractClaims.requestId = null;

    this.setMessage("", "claims"); // ✅ Always clear extracting message when aborting
  }

  #setClaims(newClaims) {
    if (
      Array.isArray(newClaims) &&
      (typeof newClaims[0] === "string" ||
        (typeof newClaims[0] === "object" &&
          newClaims[0] !== null &&
          "text" in newClaims[0]))
    ) {
      newClaims = this.#convertResponsesToClaims(newClaims);
    }

    this.claims = newClaims.map((claim) => {
      const updatedClaim = {
        ...claim,
        grounding: claim.grounding ?? null,
        groundingEvidences: claim.groundingEvidences ?? {},
      };
      if (this.displayCoreClaims) {
        updatedClaim.core = claim.core ?? null;
      }
      return updatedClaim;
    });

    this.#refreshContainer();
    return this;
  }

  #resetMatches() {
    this.matches = [];
    this.#updateFilterToggleVisibility(); // ✅ Ensure filters update correctly
    this.#refreshContainer();
  }

  async #createQueries() {
    if (this.claims.length === 0) {
      console.warn("⚠️ Cannot create queries: No claims available.");
      return;
    }

    const parameters = this.#getAnnotationParameters();
    const params = JSON.stringify(parameters);

    // 🔹 Abort previous request if it exists
    if (this.ongoingRequests.createQueries.controller) {
      this.ongoingRequests.createQueries.controller.abort();
    }

    // 🔹 Create controller and requestId
    const controller = new AbortController();
    const requestId = Date.now();

    // 🔹 Store request state
    this.ongoingRequests.createQueries = { controller, requestId, params };

    this.setMessage(this.#it("creating_queries"), "search");

    try {
      const queries = await this.backend.createQueries(
        parameters,
        controller.signal,
      );

      // 🔹 Ignore outdated result
      if (this.ongoingRequests.createQueries.requestId !== requestId) {
        console.warn("⚠️ Outdated createQueries result ignored.");
        return;
      }

      if (!Array.isArray(queries)) {
        console.error("❌ Invalid results:", queries);
        this.setMessage(this.#et("creation_issue"), "search");
        return;
      }

      this.queries = queries.map((query) => ({
        claims: query.claims,
        keywords: query.keywords,
        query: query.query,
      }));

      this.#refreshContainer();
      this.setMessage(this.#it("creation_complete"), "search");
    } catch (error) {
      // ✅ NEW: ignore error if the request was aborted (requestId !== requestId or controller.signal.aborted)
      if (
        this.ongoingRequests.createQueries.requestId !== requestId ||
        controller.signal.aborted
      ) {
        console.warn("⚠️ createQueries error ignored due to abort.");
        return;
      }

      console.error("❌ Error creating queries:", error);
      this.setMessage(this.#et("creation_issue"), "search");
    } finally {
      // 🔹 Reset controller only if still active request
      if (this.ongoingRequests.createQueries.requestId === requestId) {
        this.ongoingRequests.createQueries.controller = null;
      }
      setTimeout(() => this.setMessage("", "search"), 2000); // ✅ Cleanly hide message after delay
    }
  }

  async #matchClaims() {
    if (this.claims.length === 0 || this.evidences.length === 0) {
      console.warn("⚠️ Cannot match claims: No claims or evidences available.");
      return;
    }

    const parameters = this.#getAnnotationParameters();
    const params = JSON.stringify(parameters);

    // 🔹 Abort previous request if it exists
    if (this.ongoingRequests.matchClaims.controller) {
      this.ongoingRequests.matchClaims.controller.abort();
    }

    // 🔹 Create controller and requestId
    const controller = new AbortController();
    const requestId = Date.now();

    // 🔹 Store request state
    this.ongoingRequests.matchClaims = { controller, requestId, params };

    this.setMessage(this.#it("matching_claims"), "evidences");

    try {
      const matches = await this.backend.matchClaims(
        parameters,
        controller.signal,
      );

      // 🔹 Ignore outdated result
      if (this.ongoingRequests.matchClaims.requestId !== requestId) {
        console.warn("⚠️ Outdated matchClaims result ignored.");
        return;
      }

      if (!Array.isArray(matches)) {
        console.error("❌ Invalid match results:", matches);
        this.setMessage(this.#et("matching_issue"), "evidences");
        return;
      }

      this.matches = matches.map((match) => ({
        claim: match.claim,
        evidence: match.evidence,
        grounding: match.grounding,
        selections: match.selections,
      }));

      this.selectedEvidenceIndex = null;
      this.#refreshContainer();
      this.setMessage(this.#it("matching_complete"), "evidences");
    } catch (error) {
      // ✅ NEW: ignore error if the request was aborted (requestId !== requestId or controller.signal.aborted)
      if (
        this.ongoingRequests.matchClaims.requestId !== requestId ||
        controller.signal.aborted
      ) {
        console.warn("⚠️ matchClaims error ignored due to abort.");
        return;
      }

      console.error("❌ Error matching claims:", error);
      this.setMessage(this.#et("matching_issue"), "evidences");
    } finally {
      // 🔹 Reset controller only if still active request
      if (this.ongoingRequests.matchClaims.requestId === requestId) {
        this.ongoingRequests.matchClaims.controller = null;
      }
      setTimeout(() => this.setMessage("", "evidences"), 2000); // ✅ Cleanly hide message after delay
    }
  }

  #syncMatchesAfterDeletion(
    deletedClaimIndex = null,
    deletedEvidenceIndex = null,
  ) {
    if (!this.matches.length && !this.claims.length) return;

    // ✅ Clean matches first
    this.matches = this.matches
      .filter((match) => {
        if (deletedClaimIndex !== null && match.claim === deletedClaimIndex) {
          return false;
        }
        if (
          deletedEvidenceIndex !== null &&
          match.evidence === deletedEvidenceIndex
        ) {
          return false;
        }
        return true;
      })
      .map((match) => {
        if (
          deletedEvidenceIndex !== null &&
          match.evidence > deletedEvidenceIndex
        ) {
          match.evidence -= 1;
        }
        if (deletedClaimIndex !== null && match.claim > deletedClaimIndex) {
          match.claim -= 1;
        }
        return match;
      });

    // ✅ NEW: Also clean each claim.groundingEvidences if an evidence was deleted
    if (deletedEvidenceIndex !== null) {
      this.claims.forEach((claim) => {
        if (claim.groundingEvidences) {
          const updatedGroundingEvidences = {};
          Object.keys(claim.groundingEvidences).forEach((key) => {
            const index = parseInt(key, 10);
            if (index < deletedEvidenceIndex) {
              updatedGroundingEvidences[index] =
                claim.groundingEvidences[index];
            } else if (index > deletedEvidenceIndex) {
              updatedGroundingEvidences[index - 1] =
                claim.groundingEvidences[index];
            }
            // 🛠️ Important: Ignore deleted index completely
          });
          claim.groundingEvidences = updatedGroundingEvidences;
        }
      });
    }
  }

  #handleSearchClaim(claimIndex) {
    if (!this.claims[claimIndex]) {
      console.warn(`⚠️ Invalid claim index: ${claimIndex}`);
      return;
    }

    const claimText = this.claims[claimIndex].selections
      .map((s) => s.text)
      .join(" ");
    const promptText = this.question; // 🔹 Use the original prompt, NOT the existing search input!

    const fullQuery = `${promptText} ${claimText}`.trim(); // 🔹 Ensures correct format

    this.#handleSearch("text", fullQuery); // 🔹 Send correct query to search
  }

  async #handleSearch(
    type = "text",
    value = this.searchInput.value,
    extraQuery = "",
  ) {
    let query = null;

    if (type === "text") {
      query = value.trim();
    } else if (type === "claims" || type === "keywords") {
      if (this.selectedClaimIndex === null) return;

      const matchingQuery = this.queries.find((q) =>
        q.claims.includes(this.selectedClaimIndex),
      );
      if (!matchingQuery) return;

      query =
        type === "claims"
          ? matchingQuery.query
          : `${this.question} ${matchingQuery.keywords}`;
    }

    if (extraQuery.trim()) {
      query = `${query} ${extraQuery}`;
    }

    if (!query) return;

    this.searchInput.value = query;

    // 🔹 Abort previous and set requestId
    if (this.ongoingRequests.search.controller) {
      this.ongoingRequests.search.controller.abort();
    }

    const controller = new AbortController(); // 🔹 Create new controller
    const requestId = Date.now(); // 🔹 Generate unique requestId
    this.ongoingRequests.search = { controller, query, requestId }; // 🔹 Store

    this.setMessage(this.#it("searching"), "search");

    const searchSettings = {};
    const searchParameters = { query: query };

    if (this.searchWithDate) {
      searchParameters.questionDate = this.questionDate;
      searchParameters.responseDate = this.responseDate;
    }

    try {
      const searchResults = await this.backend.handleSearch(
        searchParameters,
        searchSettings,
        controller.signal,
      );

      // 🔹 Ignore if outdated
      if (this.ongoingRequests.search.requestId !== requestId) {
        console.warn("⚠️ Outdated search result ignored.");
        return;
      }

      if (controller.signal.aborted) {
        console.warn("⚠️ Search aborted after execution.");
        return;
      }

      this.setSearchResults(
        searchResults.length ? searchResults : this.#et("no_results"),
      );
    } catch (error) {
      // ✅ NEW: ignore error if request was aborted
      if (
        this.ongoingRequests.search.requestId !== requestId ||
        controller.signal.aborted
      ) {
        console.warn("⚠️ handleSearch error ignored due to abort.");
        return;
      }

      console.error("❌ Search failed:", error);
      this.setSearchResults(this.#et("error_retrieving"));
    } finally {
      // 🔹 Reset only if requestId matches
      if (this.ongoingRequests.search.requestId === requestId) {
        this.ongoingRequests.search.controller = null;
      }
      this.setMessage("", "search");
    }
  }

  //#endregion

  //#region CLAIM MANAGEMENT

  #convertResponsesToClaims(responseTexts) {
    let claims = [];
    let currentOffset = 0;

    responseTexts.forEach((responseText) => {
      const text =
        typeof responseText === "object" ? responseText.text : responseText;
      const core = typeof responseText === "object" ? responseText.core : null;

      const startOffset = this.response.indexOf(text, currentOffset);

      if (startOffset === -1) {
        console.warn(
          "⚠️ Warning: Claim text not found in main response: " +
            JSON.stringify(text),
        );
        return;
      }

      const endOffset = startOffset + text.length;
      claims.push({
        selections: [{ text: text, range: { startOffset, endOffset } }],
        text: text,
        grounding: null,
        groundingEvidences: {},
        criticality: null,
        comment: this.isClaimComments ? "" : undefined,
        core: core,
      });

      currentOffset = endOffset; // Move forward to prevent duplicate matches
    });

    return claims;
  }

  #tokenizeText(text) {
    // \p{L} matches any kind of letter from any language (including Kanji/Kana)
    // \p{P} matches any kind of punctuation character
    const regex = /(\$?\d+(?:\.\d+)?%?)|([\p{L}]+(?:[-'][\p{L}]+)*)|([\p{P}.,!?;:]+)|(\s+)/gu;
    let match;
    let tokens = [];

    while ((match = regex.exec(text)) !== null) {
      let token = match[0];
      let type;

      if (/^\s+$/.test(token)) type = "space";
      // Check for standard or unicode punctuation
      else if (/^[\p{P}.,!?;:]+$/u.test(token)) type = "punctuation";
      else if (/^\$?\d+(\.\d+)?%?$/.test(token)) type = "number";
      else type = "word";

      let tokenObj = {
        text: token,
        startOffset: match.index,
        endOffset: match.index + token.length,
        type,
      };

      tokens.push(tokenObj);
    }
    return tokens;
  }

  #processEntities(text) {
    if (typeof text !== "string" || text.length === 0) {
      console.error("Error: Invalid text input for entity processing", text);
      return [];
    }

    // Tokenize the text before processing entities
    const tokens = this.#tokenizeText(text);

    if (!Array.isArray(tokens) || tokens.length === 0) {
      console.error("Error: Tokenization failed or returned empty array");
      return [];
    }

    let entities = [];
    let currentEntity = null;

    tokens.forEach((token) => {
      let isSelectable = token.type !== "punctuation" && token.type !== "space";

      if (!currentEntity) {
        // Start a new entity with the first token
        currentEntity = {
          text: token.text,
          startOffset: token.startOffset,
          endOffset: token.endOffset,
          isSelection: isSelectable,
          tokens: [token],
        };
        entities.push(currentEntity);
      } else {
        if (currentEntity.isSelection) {
          // If current entity is selectable
          if (isSelectable) {
            // Extend the existing selectable entity
            currentEntity.text += token.text;
            currentEntity.endOffset = token.endOffset;
            currentEntity.tokens.push(token);
          } else {
            // Start a new non-selectable entity
            currentEntity = {
              text: token.text,
              startOffset: token.startOffset,
              endOffset: token.endOffset,
              isSelection: false,
              tokens: [token],
            };
            entities.push(currentEntity);
          }
        } else {
          // If current entity is non-selectable
          if (!isSelectable) {
            // Extend the existing non-selectable entity
            currentEntity.text += token.text;
            currentEntity.endOffset = token.endOffset;
            currentEntity.tokens.push(token);
          } else {
            // Start a new selectable entity
            currentEntity = {
              text: token.text,
              startOffset: token.startOffset,
              endOffset: token.endOffset,
              isSelection: true,
              tokens: [token],
            };
            entities.push(currentEntity);
          }
        }
      }
    });

    return entities;
  }

  #sortClaims() {
    this.claims.sort((a, b) => {
      const aStart =
        a.selections.length > 0 ? a.selections[0].range.startOffset : Infinity;
      const bStart =
        b.selections.length > 0 ? b.selections[0].range.startOffset : Infinity;
      return aStart - bStart;
    });
  }

  #adjustSelection(selection) {
    // expands to pick only full selectable entities
    let newStart = selection.range.startOffset;
    let newEnd = selection.range.endOffset;

    // Find the closest entity covering the selection start
    let startEntityIndex = this.entities.findIndex(
      (entity) => entity.startOffset <= newStart && entity.endOffset > newStart,
    );

    // Find the closest entity covering the selection end
    let endEntityIndex = this.entities.findIndex(
      (entity) => entity.startOffset < newEnd && entity.endOffset >= newEnd,
    );

    // 🔥 If startEntityIndex is invalid, find the nearest selectable entity
    if (startEntityIndex === -1) {
      startEntityIndex = this.entities.findIndex(
        (entity) => entity.isSelection,
      );
    }

    // 🔥 If endEntityIndex is invalid, find the last selectable entity
    if (endEntityIndex === -1) {
      endEntityIndex = [...this.entities]
        .reverse()
        .findIndex((entity) => entity.isSelection);
      if (endEntityIndex !== -1)
        endEntityIndex = this.entities.length - 1 - endEntityIndex; // Fix reversed index
    }

    // Ensure valid entity selection
    if (startEntityIndex === -1 || endEntityIndex === -1) {
      console.error("Error: Could not determine entity boundaries.");
      return selection;
    }

    let startEntity = this.entities[startEntityIndex];
    let endEntity = this.entities[endEntityIndex];

    // ✅ Adjust selection start: Move to the first selectable entity
    if (!startEntity?.isSelection) {
      startEntity = this.entities[startEntityIndex + 1] ?? startEntity;
    }

    // ✅ Adjust selection end: Move to the last selectable entity
    if (!endEntity?.isSelection) {
      endEntity = this.entities[endEntityIndex - 1] ?? endEntity;
    }

    // Ensure final adjustments respect entity boundaries
    if (startEntity?.isSelection) newStart = startEntity.startOffset;
    if (endEntity?.isSelection) newEnd = endEntity.endOffset;

    if (newStart >= newEnd) {
      console.error("Error: Adjusted selection is invalid (start >= end).");
      return selection;
    }

    return {
      text: this.response.substring(newStart, newEnd),
      range: { startOffset: newStart, endOffset: newEnd },
    };
  }

  #getUserSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString();

    if (!selectedText) {
      console.warn("⚠️ No text selected!");
      return { error: this.#et("no_text_selected") };
    }

    const selectionRange = selection.getRangeAt(0);

    let startOffset = null;
    let endOffset = null;
    let accumulatedOffset = 0;

    const iterator = document.createNodeIterator(
      this.responseTextContainer,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );

    let currentNode;
    while ((currentNode = iterator.nextNode())) {
      if (currentNode === selectionRange.startContainer) {
        startOffset = accumulatedOffset + selectionRange.startOffset;
      }
      if (currentNode === selectionRange.endContainer) {
        endOffset = accumulatedOffset + selectionRange.endOffset;
        break;
      }
      accumulatedOffset += currentNode.textContent.length;
    }

    if (startOffset === null || endOffset === null) {
      return { error: this.#et("incorrect_offsets") };
    }

    return {
      text: selectedText,
      range: { startOffset, endOffset },
    };
  }

  #hasOverlap(selection, claims) {
    return claims.some((claim, index) =>
      claim.selections.some(
        (existingSelection) =>
          !(
            selection.range.endOffset <= existingSelection.range.startOffset ||
            selection.range.startOffset >= existingSelection.range.endOffset
          ),
      ),
    );
  }

  #addSimpleClaim() {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    const selection = this.#getUserSelection();
    if (selection.error) {
      this.#showError(selection.error);
      return;
    }

    const adjustedSelection = this.#adjustSelection(selection);
    if (
      !this.overlapAllowed &&
      this.#hasOverlap(adjustedSelection, this.claims)
    ) {
      this.#showError(this.#et("no_overlapping_allowed"));
      window.getSelection().removeAllRanges();
      return;
    }

    this.claims.push({
      selections: [adjustedSelection],
      text: adjustedSelection.text,
      grounding: null,
      groundingEvidences: {},
      comment: this.isClaimComments ? "" : undefined,
    });
    this.#markUnsaved();

    window.getSelection().removeAllRanges();
    this.#sortClaims();
    this.#resetMatches();
    this.#refreshContainer();
  }

  #addToSelections() {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    if (
      this.selectedClaimIndex === null ||
      this.selectedClaimIndex === undefined
    ) {
      this.#showError(this.#et("no_claim_selected"));
      return;
    }

    const selection = this.#getUserSelection();
    if (selection.error) {
      this.#showError(selection.error);
      return;
    }

    const currentClaim = this.claims[this.selectedClaimIndex];
    currentClaim.selections.push(selection);
    currentClaim.text = currentClaim.selections.map((s) => s.text).join(" ");

    this.#markUnsaved();
    this.#sortClaims();
    this.#refreshContainer();
  }

  #clearSelections() {
    if (
      this.selectedClaimIndex === null ||
      this.selectedClaimIndex === undefined
    ) {
      this.#showError(this.#et("no_claim_selected"));
      return;
    }

    this.claims[this.selectedClaimIndex].selections = [];
    this.claims[this.selectedClaimIndex].text = "";

    this.#markUnsaved();
    this.#refreshActionButtons();
    this.#refreshContainer();
  }

  #removeClaim(index) {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    const removedClaim = this.claims.splice(index, 1)[0];
    this.#markUnsaved();

    if (
      this.isClaimComments &&
      removedClaim &&
      removedClaim.comment !== undefined
    ) {
      removedClaim.comment = "";
    }

    this.#syncMatchesAfterDeletion(index, null);

    if (index >= this.claims.length) {
      index = this.claims.length - 1;
    }

    this.#refreshContainer();
  }

  #handleClaimAdjustment(claimIndex, startOffset, endOffset) {
    if (claimIndex === null || claimIndex >= this.claims.length) {
      console.error("❌ Invalid claim index.");
      return;
    }

    const claim = this.claims[claimIndex];
    if (!claim || !claim.selections.length) {
      console.error("❌ Selected claim is invalid or has no selections.");
      return;
    }

    // Compute adjusted selection
    const adjustedSelection = this.#adjustSelection({
      text: this.response.substring(startOffset, endOffset),
      range: { startOffset, endOffset },
    });

    // Ensure the selection overlaps the current claim
    if (!this.#hasOverlap(adjustedSelection, [claim])) {
      this.#showError(this.#et("no_overlapping_present"));
      return;
    }

    // Ensure no overlap with other claims
    if (
      !this.overlapAllowed &&
      this.#hasOverlap(
        adjustedSelection,
        this.claims.filter((_, i) => i !== claimIndex),
      )
    ) {
      this.#showError(this.#et("cannot_overlap_claims"));
      return;
    }

    // Apply the adjusted selection
    claim.selections[0] = adjustedSelection;
    claim.text = adjustedSelection.text;
    claim.grounding = null;
    claim.groundingEvidences = {};

    this.#markUnsaved();
    this.#resetMatches();
  }

  #adjustClaim() {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    if (this.selectedClaimIndex === null) {
      console.error("❌ No claim is selected.");
      return;
    }

    const selection = this.#getUserSelection();
    if (selection.error) {
      this.#showError(selection.error);
      return;
    }

    this.#handleClaimAdjustment(
      this.selectedClaimIndex,
      selection.range.startOffset,
      selection.range.endOffset,
    );
  }

  #getClickOffset() {
    const userSelection = window.getSelection();
    if (!userSelection.rangeCount) return null;

    const range = userSelection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(this.responseTextContainer);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  }

  #splitClaim() {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    if (this.selectedClaimIndex === null) {
      console.error("❌ No claim is selected.");
      return;
    }

    const claim = this.claims[this.selectedClaimIndex];
    if (!claim || !claim.selections.length) {
      console.error("❌ Selected claim is invalid or has no selections.");
      return;
    }

    const splitOffset = this.#getClickOffset();
    if (splitOffset === null) {
      console.warn("⚠️ Invalid split position.");
      return;
    }

    const selection = {
      text: this.response.substring(
        claim.selections[0].range.startOffset,
        splitOffset,
      ),
      range: {
        startOffset: claim.selections[0].range.startOffset,
        endOffset: splitOffset,
      },
    };

    const adjustedSelection = this.#adjustSelection(selection);
    if (
      !adjustedSelection ||
      adjustedSelection.range.startOffset === adjustedSelection.range.endOffset
    ) {
      console.warn("⚠️ Adjustment failed or resulted in an empty selection.");
      return;
    }

    let secondPartStart = adjustedSelection.range.endOffset;
    let secondPartText = this.response
      .substring(secondPartStart, claim.selections[0].range.endOffset)
      .trim();

    if (!secondPartText) {
      console.warn("⚠️ No content for second claim. Split aborted.");
      return;
    }

    const secondPartEntities = this.entities.filter(
      (entity) =>
        entity.startOffset >= secondPartStart &&
        entity.endOffset <= claim.selections[0].range.endOffset,
    );

    const firstSelectableEntity = secondPartEntities.find(
      (entity) => entity.isSelection,
    );
    if (firstSelectableEntity) {
      secondPartStart = firstSelectableEntity.startOffset;
      secondPartText = this.response
        .substring(secondPartStart, claim.selections[0].range.endOffset)
        .trim();
    }

    claim.selections[0] = adjustedSelection;
    claim.text = adjustedSelection.text;
    claim.grounding = null;
    claim.groundingEvidences = {};
    claim.core = null;

    const newClaim = {
      selections: [
        {
          text: secondPartText,
          range: {
            startOffset: secondPartStart,
            endOffset: claim.selections[0].range.endOffset,
          },
        },
      ],
      text: secondPartText,
      grounding: null,
      core: null,
      groundingEvidences: {},
    };

    this.claims.splice(this.selectedClaimIndex + 1, 0, newClaim);
    this.#markUnsaved();
    this.#resetMatches();
  }

  #mergeClaims() {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    if (this.selectedClaimIndex === null) return;

    if (this.selectedClaimIndex >= this.claims.length - 1) {
      this.#showError(this.#et("cannot_merge_last_claim"));
      return;
    }

    const currentClaim = this.claims[this.selectedClaimIndex];
    const nextClaim = this.claims[this.selectedClaimIndex + 1];

    if (!currentClaim || !nextClaim) return;

    const mergedText = `${currentClaim.text} ${nextClaim.text}`.trim();
    const mergedSelections = [
      {
        text: mergedText,
        range: {
          startOffset: currentClaim.selections[0].range.startOffset,
          endOffset: nextClaim.selections[0].range.endOffset,
        },
      },
    ];

    currentClaim.text = mergedText;
    currentClaim.selections = mergedSelections;
    currentClaim.grounding = null;
    currentClaim.core = null;
    currentClaim.groundingEvidences = {};

    this.claims.splice(this.selectedClaimIndex + 1, 1);

    this.#markUnsaved();
    this.#resetMatches();
  }

  #addEmptyClaim() {
    this.#abortExtractClaims(); // 🔥 Added to stop ongoing extractClaims if running

    const newClaim = {
      selections: [],
      text: "",
      grounding: null,
      groundingEvidences: {},
    };
    this.claims.push(newClaim);
    if (this.multiSelections) this.selectedClaimIndex = this.claims.length - 1;
    this.#markUnsaved();
    this.#refreshContainer();
  }

  //#endregion

  //#region PUBLIC METHODS

  setStyles(newStyles) {
    this.styles = newStyles;
    document.getElementById("claims-styles").textContent = newStyles;
    return this;
  }

  setColors(newColors, newIntersectionColor = null) {
    this.colors = newColors;
    if (newIntersectionColor) {
      this.intersectionColor = newIntersectionColor;
    }
    return this;
  }

  setMessage(message, where = "general") {
    let targetContainer;

    switch (where) {
      case "evidences":
        targetContainer = this.evidenceMessageContainer;
        break;
      case "claims":
        targetContainer = this.claimsMessageContainer;
        break;
      default:
        targetContainer = this.messageContainer;
    }

    targetContainer.style.cssText = `
			width: 100%;
			text-align: center;
			font-size: 14px; /* ✅ Uniform size */
			font-weight: normal; /* ✅ Not bold */
			color: red; /* ✅ Consistent red */
			padding: 5px;
			display: none;
			border-bottom: 1px solid #ddd;
		`;

    if (message) {
      targetContainer.textContent = message;
      targetContainer.style.display = "block";
      targetContainer.style.visibility = "visible";
      targetContainer.style.opacity = "1";
    } else {
      targetContainer.textContent = "";
      targetContainer.style.display = "none";
    }
  }

  #showError(message, where = "general") {
    let targetContainer;

    switch (where) {
      case "evidences":
        targetContainer = this.evidenceMessageContainer;
        break;
      case "claims":
        targetContainer = this.claimsMessageContainer;
        break;
      default:
        targetContainer = this.messageContainer;
    }

    targetContainer.innerHTML = `
			<span style="flex-grow: 1;">${message}</span>
			<button id="close-error" style="
				background: none;
				border: none;
				color: white;
				font-size: 18px;
				font-weight: bold;
				cursor: pointer;
				padding: 0 10px;
			">&times;</button>
		`;

    // Apply softer error styling
    targetContainer.style.display = "flex";
    targetContainer.style.alignItems = "center";
    targetContainer.style.justifyContent = "space-between";
    targetContainer.style.backgroundColor = "#ff7f7f"; // Softer red (pastel-like)
    targetContainer.style.color = "white";
    targetContainer.style.padding = "10px";
    targetContainer.style.borderRadius = "5px";
    targetContainer.style.fontWeight = "bold";
    targetContainer.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.2)"; // Soft shadow

    // Add close button functionality
    document.getElementById("close-error").addEventListener("click", () => {
      targetContainer.style.display = "none";
    });

    // Auto-hide after 5 seconds
    setTimeout(() => {
      targetContainer.style.display = "none";
    }, 5000);
  }

  getClaims() {
    return this.claims;
  }

  //#endregion

  //#region DATA INTERFACE MANAGEMENT

  #startAutoSave() {
    if (this.autoSave) {
      clearInterval(this.autoSave); // ✅ Clear existing auto-save
    }

    this.autoSave = setInterval(() => {
      this.#saveAnnotations(false);
    }, this.autoSaveInterval * 1000);
  }

  #saveAnnotations(userInitiated = false) {
    if (!this.annotationsField || typeof survey.setValue !== "function") return;

    try {
      // save whether user saved manually or autosave
      if (this.saveStatusField)
        survey.setValue(this.saveStatusField, !userInitiated);

      // ✅ Force refresh before save, silently if autosave
      this._suppressStatusUpdate = true;
      this.#switchResponse(this.currentResponseIndex, !userInitiated);

      const annotationString = this.getAnnotations();
      if (annotationString !== this.lastSavedAnnotation) {
        survey.setValue(this.annotationsField, annotationString);
        this.lastSavedAnnotation = annotationString; // ✅ Update only on success
      }
      if(userInitiated) { 
        survey.validate()
      }
    } catch (error) {
      console.error("❌ Error saving annotations:", error);
    } finally {
      this._suppressStatusUpdate = false;
    }
  }

  #loadAnnotations() {
    if (!this.annotationsField || typeof survey.getValue !== "function") {
      console.warn(
        "⚠️ No annotationsField set or survey.getValue is unavailable.",
      );
      return;
    }

    try {
      const annotationString = survey.getValue(this.annotationsField);
      if (annotationString) {
        this.setAnnotations(annotationString);
        this.lastSavedAnnotation = annotationString;
      }
    } catch (error) {
      console.error("❌ Error loading annotations:", error);
    }
  }

  #getAnnotationParameters() {
    return {
      question: this.question,
      questionDate: this.questionDate,
      response: this.response,
      responseDate: this.responseDate,
      claims: this.claims.map((c) => c.text),
      evidences: this.evidences.map((e) => e.text),
    };
  }

  getAnnotations() {
    const annotationData = {
      evidences: this.evidences.map((evidence) => ({
        url: evidence.url,
        text: evidence.text,
      })),

      contextFieldValues: this.contextFieldValues,

      questionFieldValues: this.questionFieldValues.map((field) => {
        // ✅ CHANGED: include labelKey if available
        const result = {
          label: field.label,
          value: field.value,
        };
        if (field.name) {
          result.name = field.name;
        }
        if (field.labelKey) {
          // ✅ CHANGED: add labelKey if exists
          result.labelKey = field.labelKey;
        }
        return result;
      }),

      responses: this.all.map((responseEntry) => ({
        responseFieldValues: (responseEntry.responseFieldValues ?? []).map(
          (field) => {
            // ✅ CHANGED: include labelKey if available
            const result = {
              label: field.label,
              value: field.value,
            };
            if (field.name) {
              result.name = field.name;
            }
            if (field.labelKey) {
              // ✅ CHANGED: add labelKey if exists
              result.labelKey = field.labelKey;
            }
            return result;
          },
        ),

        claims: responseEntry.claims.map((claim) => {
          const claimData = {
            selections: claim.selections,
            text: claim.text,
            grounding: claim.grounding,
            groundingEvidences: claim.groundingEvidences || {},
            criticality: claim.criticality ?? null,
            core: claim.core ?? null,
          };

          if (this.isClaimComments) {
            claimData.comment = claim.comment ?? "";
          }

          return claimData;
        }),

        matches: responseEntry.matches.map((match) => ({
          claim: match.claim,
          evidence: match.evidence,
          grounding: match.grounding,
          selections: match.selections,
        })),
      })),
    };

    return JSON.stringify(annotationData, null, 2);
  }

  setAnnotations(annotationString) {
    try {
      const annotationData = JSON.parse(annotationString || "{}");

      this.evidences = annotationData.evidences ?? [];
      this.contextFieldValues = annotationData.contextFieldValues ?? [];
      this.questionFieldValues = annotationData.questionFieldValues ?? [];

      this.all.forEach((response, index) => {
        response.responseFieldValues =
          annotationData.responses?.[index]?.responseFieldValues ?? [];
        response.claims = annotationData.responses?.[index]?.claims ?? [];
        response.matches = annotationData.responses?.[index]?.matches ?? [];
      });

      if (this.contextToggleManager) {
        setTimeout(() => {
          this.contextToggleManager.setToggleFieldValues({
            values: this.contextFieldValues,
          }); // 🔵 Pass values properly
        }, 0);
      }

      const trySetQuestionToggles = () => {
        if (this.questionToggleManager) {
          this.questionToggleManager.setToggleFieldValues({
            values: this.questionFieldValues,
          }); // 🔵 Pass values properly
        } else {
          setTimeout(trySetQuestionToggles, 50);
        }
      };
      trySetQuestionToggles();

      setTimeout(() => {
        this.#switchResponse(0);
      }, 0);
    } catch (error) {
      console.error("❌ Invalid JSON passed to setAnnotations:", error);
    }
  }

  //#endregion
}

/****** Project Code ********/

textManager.addTexts({
  en_US: {
    btn_add_claim: "Add claim",
    btn_add_evidence: "Add evidence",
    btn_add_to_claim: "Add to claim",
    btn_adjust_claim: "Adjust claim",
    btn_cancel: "Cancel",
    btn_clear_selections: "Clear selections",
    btn_create_queries: "Create queries",
    btn_extract_claims: "Extract claims",
    btn_help: "Help",
    btn_match_claims: "Match claims",
    btn_merge_claims: "Merge with next claim",
    btn_next_response: "Next response",
    btn_ok: "OK",
    btn_record_laim: "Record claim",
    btn_save: "Save",
    btn_search: "Search",
    btn_search_claims: "Search claims",
    btn_search_keywords: "Search keywords",
    btn_search_question: "Search prompt",
    btn_split_claim: "Split claim",
    err_cannot_merge_last_claim: "Cannot merge, this is the last claim!",
    err_cannot_overlap_claims:
      "Adjusted selection cannot overlap another claim.",
    err_creation_issue: "Error in query creation",
    err_error_retrieving: "Error retrieving search results",
    err_extracting_issue:
      "Error extracting claims, retry later or add claims manually",
    err_incorrect_offsets: "Failed to calculate selection offsets!",
    err_invalid_url: "Invalid URL. Please enter a valid source URL.",
    err_matching_issue: "Error in matching claims",
    err_no_claim_selected: "No claim selected!",
    err_no_overlapping_allowed: "Overlapping selections are not allowed!",
    err_no_overlapping_present:
      "Adjusted selection must overlap the current claim.",
    err_no_results: "No results found",
    err_no_text_provided: "No text provided. Evidence not added.",
    err_no_text_selected: "No text selected!",
    hlp_claims:
      "Use the [Match claims] button to automatically match claims and evidences",
    hlp_evidences:
      "Select the [Search] tab to find evidences and add them in the list",
    inf_creation_complete: "Creation complete",
    inf_enter_search_query: "Enter search query...",
    inf_extracting_claims: "Extracting claims...",
    inf_creating_queries: "Creating queries...",
    inf_matching_claims: "Matching claims...",
    inf_matching_complete: "Matching complete",
    inf_paste_evidence: "Paste the copied evidence text here...",
    inf_paste_url: "Paste the source URL here...",
    inf_searching: "Searching...",
    lbl_claims: "Claims",
    lbl_comments: "Comments",
    lbl_context: "Context",
    lbl_evidences: "Evidences",
    lbl_filter_evidences: "Filter",
    lbl_matched_evidences: "Evidences",
    lbl_matched_invalidated: "Invalidated",
    lbl_matched_result: "Grounding",
    lbl_matched_validated: "Validated",
    lbl_no: "No",
    lbl_country: "Country",
    lbl_question: "Prompt",
    lbl_question_date: "Prompt date",
    lbl_response: "Response",
    lbl_response_date: "Response date",
    lbl_search: "Search",
    lbl_yes: "Yes",
  },
  ja_JP: {
    btn_add_claim: "主張を追加",
    btn_add_evidence: "証拠を追加",
    btn_add_to_claim: "主張に追加",
    btn_adjust_claim: "主張を調整",
    btn_cancel: "キャンセル",
    btn_clear_selections: "選択をクリア",
    btn_create_queries: "クエリを作成",
    btn_extract_claims: "主張を照合",
    btn_help: "ヘルプ",
    btn_match_claims: "主張を照合",
    btn_merge_claims: "次の主張を照合",
    btn_next_response: "次の回答",
    btn_ok: "OK",
    btn_record_laim: "主張を記録",
    btn_save: "保存",
    btn_search: "検索",
    btn_search_claims: "主張を検索",
    btn_search_keywords: "キーワードを検索",
    btn_search_question: "プロンプトを検索",
    btn_split_claim: "主張を分割",
    err_cannot_merge_last_claim: "統合できません、最後の主張です。",
    err_cannot_overlap_claims: "調整された選択が他の主張と重なっています。",
    err_creation_issue: "クエリ作成エラー",
    err_error_retrieving: "検索結果取得エラー",
    err_extracting_issue:
      "主張の抽出にエラー、後で試すか手動で追加してください。",
    err_incorrect_offsets: "選択のオフセット計算に失敗しました。",
    err_invalid_url: "無効なURL。有効なソースURLを入力してください。",
    err_matching_issue: "主張の照合エラー",
    err_no_claim_selected: "主張が選択されていません。",
    err_no_overlapping_allowed: "重複した選択は許可されていません。",
    err_no_overlapping_present:
      "調整された選択は現在の主張と重なる必要があります。",
    err_no_results: "主張が選択されていません。",
    err_no_text_provided:
      "テキストが提供されていません。証拠は追加されていません。",
    err_no_text_selected: "テキストが選択されていません。",
    hlp_claims: "「主張を照合」ボタンを主張と証拠を自動的に照合してください。",
    hlp_evidences:
      "「検索」タブを選択し、証拠を見つけてリストに追加してください。",
    inf_creation_complete: "作成完了",
    inf_enter_search_query: "検索クエリを入力...",
    inf_extracting_claims: "主張を抽出中...",
    inf_creating_queries: "クエリを作成中...",
    inf_matching_claims: "主張を照合中...",
    inf_matching_complete: "照合完了",
    inf_paste_evidence: "コピーした証拠テキストをここに貼り付けてください...",
    inf_paste_url: "ソースURLをここに貼り付けてください...",
    inf_searching: "検索中....",
    lbl_claims: "主張",
    lbl_comments: "コメント",
    lbl_context: "コンテキスト",
    lbl_evidences: "証拠",
    lbl_filter_evidences: "フィルター",
    lbl_matched_evidences: "証拠",
    lbl_matched_invalidated: "無効化",
    lbl_matched_result: "根拠付き",
    lbl_matched_validated: "確認済",
    lbl_no: "いいえ",
    lbl_country: "国",
    lbl_question: "プロンプト",
    lbl_question_date: "プロンプトの日付",
    lbl_response: "回答",
    lbl_response_date: "回答の日付",
    lbl_search: "検索",
    lbl_yes: "はい",
  },
});

let claimsManager = new ClaimsManager({
  backendSettings: survey.getVariable("claimsManagerBackendSettings"),
  uiSettings: survey.getVariable("claimsManagerUISettings"),
  dataSettings: survey.getVariable("claimsManagerDataSettings"),
});

// ✅ Store in `window` for global access if needed
window.claimsManager = claimsManager;
