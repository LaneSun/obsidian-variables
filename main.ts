import { Plugin, MarkdownView, PluginSettingTab, Setting, App } from "obsidian";
import { Extension, StateField } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView as CMEditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

class VariableWidget extends WidgetType {
	constructor(
		private value: string,
		private varName: string,
		private enableTooltips: boolean = true,
	) {
		super();
	}

	toDOM() {
		const span = document.createElement("span");
		span.className = "cm-variable-replacement";
		span.textContent = this.value;
		if (this.enableTooltips) {
			span.title = `Variable: {${this.varName}} = ${this.value}`;
		}
		return span;
	}

	eq(other: VariableWidget) {
		return this.value === other.value && this.varName === other.varName;
	}
}

class MissingVariableWidget extends WidgetType {
	constructor(
		private placeholder: string,
		private varName: string,
		private enableTooltips: boolean = true,
	) {
		super();
	}

	toDOM() {
		const span = document.createElement("span");
		span.className = "cm-variable-missing";
		span.textContent = this.placeholder;
		if (this.enableTooltips) {
			span.title = `Missing variable: {${this.varName}}`;
		}
		return span;
	}

	eq(other: MissingVariableWidget) {
		return (
			this.placeholder === other.placeholder &&
			this.varName === other.varName
		);
	}
}

interface VariablesPluginSettings {
	enableVariableReplacement: boolean;
	variablePattern: string;
	showMissingVariables: boolean;
	missingVariableText: string;
	enableTooltips: boolean;
}

const DEFAULT_SETTINGS: VariablesPluginSettings = {
	enableVariableReplacement: true,
	variablePattern: "{([^}]+)}",
	showMissingVariables: true,
	missingVariableText: "[UNDEFINED]",
	enableTooltips: true,
};

export default class VariablesPlugin extends Plugin {
	settings: VariablesPluginSettings;

	async onload() {
		await this.loadSettings();

		// Register the editor extension
		this.registerEditorExtension([this.createVariableExtension()]);

		// Register markdown post processor for Reading mode
		this.registerMarkdownPostProcessor(
			this.processVariablesInReading.bind(this),
		);

		// Add settings tab
		this.addSettingTab(new VariablesSettingTab(this.app, this));

		// Add CSS styles
		this.addStyle();
	}

	onunload() {
		// Cleanup styles
		const styleEl = document.getElementById("variables-plugin-styles");
		if (styleEl) {
			styleEl.remove();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addStyle() {
		const css = `
		.cm-variable-replacement {
			text-decoration: underline;
		}

		.cm-variable-missing {
			text-decoration: underline;
			opacity: 0.6;
		}

		.cm-variable-editing {
			text-decoration: underline;
			font-family: monospace;
			cursor: text;
		}
		`;

		const styleEl = document.createElement("style");
		styleEl.id = "variables-plugin-styles";
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
	}

	public refreshVariables() {
		// Force refresh of all editor views
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.editor) {
				// Trigger a view update to refresh decorations
				const editor = leaf.view.editor;
				const cursor = editor.getCursor();
				editor.setCursor(cursor);
			}
		});

		// Also refresh reading mode if applicable
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf && activeLeaf.view instanceof MarkdownView) {
			activeLeaf.view.previewMode.rerender(true);
		}
	}

	private createVariableExtension(): Extension {
		// State field to track cursor position
		const cursorPositionField = StateField.define<number>({
			create: () => 0,
			update: (value, tr) => {
				if (tr.selection) {
					return tr.selection.main.head;
				}
				return value;
			},
		});

		return [
			cursorPositionField,
			ViewPlugin.fromClass(
				class {
					decorations: DecorationSet;
					plugin: VariablesPlugin;

					constructor(view: CMEditorView) {
						// Get plugin instance from global app
						this.plugin =
							window.app?.plugins?.plugins?.[
								"obsidian-variables"
							];
						this.decorations = this.buildDecorations(view);
					}

					update(update: ViewUpdate) {
						if (
							update.docChanged ||
							update.viewportChanged ||
							update.selectionSet
						) {
							this.decorations = this.buildDecorations(
								update.view,
							);
						}
					}

					buildDecorations(view: CMEditorView): DecorationSet {
						if (!this.plugin?.settings.enableVariableReplacement) {
							return Decoration.none;
						}

						const builder = new RangeSetBuilder<Decoration>();
						const variables = this.getVariablesFromCurrentNote();

						if (!variables || Object.keys(variables).length === 0) {
							return builder.finish();
						}

						// Check if use-var is enabled for this note
						if (
							variables["use-var"] !== true &&
							variables["use-var"] !== "true"
						) {
							return builder.finish();
						}

						const doc = view.state.doc;
						const regex = new RegExp(
							this.plugin.settings.variablePattern,
							"g",
						);

						// Get cursor position
						const cursorPos = view.state.selection.main.head;

						for (let i = 0; i < doc.length; ) {
							const line = doc.lineAt(i);
							const text = line.text;
							let match;

							regex.lastIndex = 0; // Reset regex
							while ((match = regex.exec(text)) !== null) {
								const varName = match[1];
								const value = variables[varName];

								// Skip the use-var property itself from being replaced
								if (varName === "use-var") {
									continue;
								}

								const from = line.from + match.index;
								const to = from + match[0].length;

								// Only add decoration if it's in the viewport or close to it
								if (
									from <= view.viewport.to + 1000 &&
									to >= view.viewport.from - 1000
								) {
									// Check if cursor is within or adjacent to this variable
									const cursorInVariable =
										cursorPos >= from && cursorPos <= to;

									if (cursorInVariable) {
										// Show original text with italic styling when cursor is nearby
										builder.add(
											from,
											to,
											Decoration.mark({
												class: "cm-variable-editing",
												attributes: this.plugin.settings
													.enableTooltips
													? {
															title: `Variable: {${varName}} = ${value !== undefined ? String(value) : "[UNDEFINED]"}`,
														}
													: {},
											}),
										);
									} else if (value !== undefined) {
										// Show replaced value when cursor is not nearby
										builder.add(
											from,
											to,
											Decoration.replace({
												widget: new VariableWidget(
													String(value),
													varName,
													this.plugin.settings.enableTooltips,
												),
											}),
										);
									} else if (
										this.plugin.settings
											.showMissingVariables &&
										varName !== "use-var"
									) {
										// Show missing variable placeholder (but not for use-var)
										builder.add(
											from,
											to,
											Decoration.replace({
												widget: new MissingVariableWidget(
													this.plugin.settings.missingVariableText,
													varName,
													this.plugin.settings.enableTooltips,
												),
											}),
										);
									}
								}
							}

							i = line.to + 1;
						}

						return builder.finish();
					}

					getVariablesFromCurrentNote(): Record<string, any> | null {
						try {
							const app = window.app;
							if (!app) return null;

							const activeView =
								app.workspace.getActiveViewOfType(MarkdownView);
							if (!activeView) return null;

							const file = activeView.file;
							if (!file) return null;

							const cache = app.metadataCache.getFileCache(file);
							if (!cache?.frontmatter) return null;

							// Return all frontmatter properties as variables
							const variables: Record<string, any> = {};
							const entries = Object.keys(cache.frontmatter).map(
								(key) => [key, cache.frontmatter[key]],
							);
							for (const [key, value] of entries) {
								// Skip system properties but keep use-var for checking
								if (
									!key.startsWith("_") &&
									key !== "position"
								) {
									variables[key] = value;
								}
							}

							return variables;
						} catch (error) {
							console.error(
								"Error getting variables from note:",
								error,
							);
							return null;
						}
					}
				},
				{
					decorations: (v: any) => v.decorations,
				},
			),
		];
	}

	private processVariablesInReading(element: HTMLElement, context: any) {
		// Get the source path to identify the note
		const sourcePath = context.sourcePath;
		if (!sourcePath) return;

		// Get the file and its cache
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!file) return;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return;

		// Check if use-var is enabled for this note
		if (
			cache.frontmatter["use-var"] !== true &&
			cache.frontmatter["use-var"] !== "true"
		) {
			return;
		}

		// Get variables from frontmatter
		const variables: Record<string, any> = {};
		for (const [key, value] of Object.entries(cache.frontmatter)) {
			if (!key.startsWith("_") && key !== "position") {
				variables[key] = value;
			}
		}

		if (Object.keys(variables).length === 0) return;

		// Process all text nodes
		this.processTextNodesInElement(element, variables);
	}

	private processTextNodesInElement(
		element: HTMLElement,
		variables: Record<string, any>,
	) {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

		const textNodes: Text[] = [];
		let node;
		while ((node = walker.nextNode())) {
			textNodes.push(node as Text);
		}

		// Process text nodes in reverse order to avoid position issues
		textNodes.reverse().forEach((textNode) => {
			this.processTextNode(textNode, variables);
		});
	}

	private processTextNode(textNode: Text, variables: Record<string, any>) {
		const text = textNode.textContent || "";
		const regex = new RegExp(this.settings.variablePattern, "g");

		let match;
		const replacements: {
			start: number;
			end: number;
			replacement: HTMLElement;
		}[] = [];

		while ((match = regex.exec(text)) !== null) {
			const varName = match[1];

			// Skip the use-var property itself
			if (varName === "use-var") {
				continue;
			}

			const value = variables[varName];

			if (value !== undefined) {
				// Create replacement element for defined variables
				const span = document.createElement("span");
				span.className = "cm-variable-replacement";
				span.textContent = String(value);
				if (this.settings.enableTooltips) {
					span.title = `Variable: {${varName}} = ${value}`;
				}

				replacements.push({
					start: match.index,
					end: match.index + match[0].length,
					replacement: span,
				});
			} else if (
				this.settings.showMissingVariables &&
				varName !== "use-var"
			) {
				// Create replacement element for missing variables
				const span = document.createElement("span");
				span.className = "cm-variable-missing";
				span.textContent = this.settings.missingVariableText;
				if (this.settings.enableTooltips) {
					span.title = `Missing variable: {${varName}}`;
				}

				replacements.push({
					start: match.index,
					end: match.index + match[0].length,
					replacement: span,
				});
			}
		}

		if (replacements.length > 0) {
			this.applyReplacements(textNode, replacements);
		}
	}

	private applyReplacements(
		textNode: Text,
		replacements: {
			start: number;
			end: number;
			replacement: HTMLElement;
		}[],
	) {
		const parent = textNode.parentNode;
		if (!parent) return;

		const text = textNode.textContent || "";
		const fragment = document.createDocumentFragment();

		let lastEnd = 0;

		// Sort replacements by start position
		replacements.sort((a, b) => a.start - b.start);

		replacements.forEach(({ start, end, replacement }) => {
			// Add text before the replacement
			if (start > lastEnd) {
				fragment.appendChild(
					document.createTextNode(text.slice(lastEnd, start)),
				);
			}

			// Add the replacement element
			fragment.appendChild(replacement);

			lastEnd = end;
		});

		// Add remaining text after the last replacement
		if (lastEnd < text.length) {
			fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
		}

		// Replace the original text node with the fragment
		parent.replaceChild(fragment, textNode);
	}
}

class VariablesSettingTab extends PluginSettingTab {
	plugin: VariablesPlugin;

	constructor(app: App, plugin: VariablesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", {
			text: "Variables Plugin Settings",
		});

		new Setting(containerEl)
			.setName("Enable Variable Replacement")
			.setDesc("Turn variable replacement on or off")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableVariableReplacement)
					.onChange(async (value) => {
						this.plugin.settings.enableVariableReplacement = value;
						await this.plugin.saveSettings();
						this.plugin.refreshVariables();
					}),
			);

		new Setting(containerEl)
			.setName("Variable Pattern")
			.setDesc(
				"Regular expression pattern for matching variables (advanced users only)",
			)
			.addText((text) =>
				text
					.setPlaceholder("{([^}]+)}")
					.setValue(this.plugin.settings.variablePattern)
					.onChange(async (value) => {
						this.plugin.settings.variablePattern = value;
						await this.plugin.saveSettings();
						this.plugin.refreshVariables();
					}),
			);

		new Setting(containerEl)
			.setName("Show Missing Variables")
			.setDesc("Display a placeholder for undefined variables")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showMissingVariables)
					.onChange(async (value) => {
						this.plugin.settings.showMissingVariables = value;
						await this.plugin.saveSettings();
						this.plugin.refreshVariables();
					}),
			);

		new Setting(containerEl)
			.setName("Missing Variable Text")
			.setDesc("Text to display for missing variables")
			.addText((text) =>
				text
					.setPlaceholder("[UNDEFINED]")
					.setValue(this.plugin.settings.missingVariableText)
					.onChange(async (value) => {
						this.plugin.settings.missingVariableText = value;
						await this.plugin.saveSettings();
						this.plugin.refreshVariables();
					}),
			);

		new Setting(containerEl)
			.setName("Enable Tooltips")
			.setDesc("Show tooltips with variable information on hover")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableTooltips)
					.onChange(async (value) => {
						this.plugin.settings.enableTooltips = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
