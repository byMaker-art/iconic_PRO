import { WorkspaceLeaf } from 'obsidian';
import IconicPlugin, { FileItem, STRINGS } from 'src/IconicPlugin';
import IconManager from 'src/managers/IconManager';
import RuleEditor from 'src/dialogs/RuleEditor';
import IconPicker from 'src/dialogs/IconPicker';

/**
 * Handles icons in the Files pane.
 */
export default class FileIconManager extends IconManager {
	private containerEl: HTMLElement;
	/**
	 * Tracks pending refresh operations to prevent multiple rapid refreshes when expanding folders.
	 */
	private refreshTimerId: number;

	private dragSelectState = {
		active: false,
		startX: 0,
		startY: 0,
		overlayEl: null as HTMLElement | null,
		selectedEls: new Set<HTMLElement>(),
	};

	constructor(plugin: IconicPlugin) {
		super(plugin);
		this.plugin.registerEvent(this.app.workspace.on('file-menu', (menu, tFile) => {
			if (this.plugin.settings.showMenuActions) {
				this.onContextMenu(tFile.path);
			}
		}));
		this.plugin.registerEvent(this.app.workspace.on('files-menu', (menu, tFiles) => {
			if (this.plugin.settings.showMenuActions) {
				this.onContextMenu(...tFiles.map(tFile => tFile.path));
			}
		}));
		this.plugin.registerEvent(this.app.workspace.on('layout-change', () => {
			if (activeDocument.contains(this.containerEl)) return;
			this.app.workspace.iterateAllLeaves(leaf => this.manageLeaf(leaf));
		}));
		this.app.workspace.iterateAllLeaves(leaf => this.manageLeaf(leaf));
	}

	/**
	 * Start managing the given leaf if has a matching type.
	 */
	private manageLeaf(leaf: WorkspaceLeaf) {
		if (leaf.getViewState().type !== 'file-explorer') return;

		this.stopMutationObserver(this.containerEl);
		this.containerEl = leaf.view.containerEl.find(':scope > .nav-files-container > div');
		this.setMutationsObserver(this.containerEl, {
			subtree: true,
			childList: true,
			attributeFilter: ['data-path'],
		}, mutations => {
			for (const mutation of mutations) {
				if (mutation.attributeName === 'data-path') {
					this.refreshIcons();
					return;
				} else for (const addedNode of mutation.addedNodes) {
					if (addedNode instanceof HTMLElement && addedNode.hasClass('tree-item')) {
						this.refreshIcons();
						return;
					}
				}
			}
		});
		this.setupDragSelect(this.containerEl);
		this.refreshIcons();
	}

	private setupDragSelect(containerEl: HTMLElement): void {
		this.setEventListener(containerEl, 'mousedown', e => {
			if ((e.target as HTMLElement).closest('.tree-item-self')) return;
			if (e.button !== 0) return;
			this.startDragSelect(e);
		});
		
		this.setEventListener(activeDocument as unknown as HTMLElement, 'mousemove', e => {
			if (!this.dragSelectState.active) return;
			this.updateDragSelect(e);
		});
		
		this.setEventListener(activeDocument as unknown as HTMLElement, 'mouseup', () => {
			if (!this.dragSelectState.active) return;
			this.endDragSelect();
		});
	}

	private startDragSelect(e: MouseEvent): void {
		this.dragSelectState.active = true;
		this.dragSelectState.startX = e.clientX;
		this.dragSelectState.startY = e.clientY;
		this.dragSelectState.selectedEls.clear();

		const overlay = createDiv({ cls: 'iconic-drag-select-overlay' });
		overlay.style.left = `${e.clientX}px`;
		overlay.style.top = `${e.clientY}px`;
		overlay.style.width = '0px';
		overlay.style.height = '0px';
		activeDocument.body.appendChild(overlay);
		this.dragSelectState.overlayEl = overlay;
	}

	private updateDragSelect(e: MouseEvent): void {
		const { startX, startY, overlayEl, selectedEls } = this.dragSelectState;
		if (!overlayEl || !this.containerEl) return;

		const currentX = e.clientX;
		const currentY = e.clientY;

		const left = Math.min(startX, currentX);
		const top = Math.min(startY, currentY);
		const width = Math.abs(currentX - startX);
		const height = Math.abs(currentY - startY);

		overlayEl.style.left = `${left}px`;
		overlayEl.style.top = `${top}px`;
		overlayEl.style.width = `${width}px`;
		overlayEl.style.height = `${height}px`;

		const rect = overlayEl.getBoundingClientRect();

		const items = this.containerEl.findAll('.tree-item-self');
		for (const item of items) {
			const itemRect = item.getBoundingClientRect();
			const intersect = !(rect.right < itemRect.left || 
								rect.left > itemRect.right || 
								rect.bottom < itemRect.top || 
								rect.top > itemRect.bottom);

			if (intersect) {
				if (!selectedEls.has(item)) {
					selectedEls.add(item);
					item.addClass('iconic-drag-selected');
				}
			} else {
				if (selectedEls.has(item)) {
					selectedEls.delete(item);
					item.removeClass('iconic-drag-selected');
				}
			}
		}
	}

	private endDragSelect(): void {
		this.dragSelectState.active = false;
		if (this.dragSelectState.overlayEl) {
			this.dragSelectState.overlayEl.remove();
			this.dragSelectState.overlayEl = null;
		}

		if (this.dragSelectState.selectedEls.size > 0) {
			const files: FileItem[] = [];
			for (const el of this.dragSelectState.selectedEls) {
				el.removeClass('iconic-drag-selected');
				const id = el.dataset.path;
				if (id) {
					const fileItem = this.plugin.getFileItem(id);
					if (fileItem) files.push(fileItem);
				}
			}
			this.dragSelectState.selectedEls.clear();

			if (files.length > 0) {
				IconPicker.openMulti(this.plugin, files, (newIcon, newColor) => {
					this.plugin.saveFileIcons(files, newIcon, newColor);
					this.plugin.refreshManagers('file', 'folder');
				});
			}
		}
	}

	/**
	 * @override
	 * Refresh all file icons.
	 */
	refreshIcons(unloading?: boolean): void {
		const files = this.plugin.getFileItems(unloading);
		const itemEls = this.containerEl?.findAll(':scope > .tree-item');
		if (itemEls) this.refreshChildIcons(files, itemEls, unloading);
	}

	/**
	 * Refresh an array of file icons, including any subitems.
	 */
	private refreshChildIcons(files: FileItem[], itemEls: HTMLElement[], unloading?: boolean): void {
		for (const itemEl of itemEls) {
			itemEl.addClass('iconic-item');

			const selfEl = itemEl.find(':scope > .tree-item-self');
			const file = files.find(file => file.id === selfEl?.dataset.path);
			if (!file) continue;

			// Check for an icon ruling
			const page = file.items ? 'folder' : 'file';
			const rule = this.plugin.ruleManager.checkRuling(page, file.id, unloading) ?? file;

			if (file.items) {
				// Refresh children immediately if folder is expanded
				if (!itemEl.hasClass('is-collapsed')) {
					const childItemEls = itemEl.findAll(':scope > .tree-item-children > .tree-item');
					if (childItemEls) this.refreshChildIcons(file.items, childItemEls, unloading);
				}

				// Set up mutation observer with performance optimizations:
				// 1. Only refresh children on expand (not collapse) to reduce unnecessary updates
				// 2. Use debouncing to prevent multiple rapid refreshes
				this.setMutationsObserver(itemEl, {
					subtree: true,
					attributeFilter: ['class', 'data-path'],
					attributeOldValue: true,
				}, mutations => {
					let shouldRefreshChildren = false;
					let shouldRefreshSelf = false;

					for (const mutation of mutations) {
						if (mutation.attributeName === 'data-path') {
							shouldRefreshSelf = true;
							break;
						}

						// Refresh on folder collapse/expand
						if (mutation.attributeName === 'class' && mutation.target instanceof HTMLElement) {
							const wasCollapsed = mutation.oldValue?.includes('is-collapsed');
							const isCollapsed = mutation.target.hasClass('is-collapsed');

							// Only refresh children if expanding, not collapsing
							if (wasCollapsed && !isCollapsed) {
								shouldRefreshChildren = true;
								shouldRefreshSelf = true;
							} else if (!wasCollapsed && isCollapsed) {
								shouldRefreshSelf = true;
							}
						}
					}

					if (shouldRefreshSelf) {
						this.refreshChildIcons([file], [itemEl]);
					}
					if (shouldRefreshChildren) {
						const childItemEls = itemEl.findAll(':scope > .tree-item-children > .tree-item');
						if (file.items && childItemEls) {
							this.debouncedRefresh(file.items, childItemEls);
						}
					}
				});
			}

			// Ensure icon element positioned before filename
			let iconEl = selfEl.find(':scope > .tree-item-icon') ?? selfEl.createDiv({ cls: 'tree-item-icon' });
			const innerEl = selfEl.find('.tree-item-inner');
			if (iconEl !== innerEl?.previousElementSibling) {
				innerEl?.insertAdjacentElement('beforebegin', iconEl);
			}

			if (file.items) {
				// Toggle default icon based on expand/collapse state
				if (file.iconDefault) file.iconDefault = iconEl.hasClass('is-collapsed')
					? 'lucide-folder-closed'
					: 'lucide-folder-open';
			}

			let folderIconEl = selfEl.find(':scope > .iconic-sidekick:not(.tree-item-icon)');
			if (this.plugin.settings.minimalFolderIcons || !this.plugin.settings.showAllFolderIcons && !rule.icon && !rule.iconDefault) {
				folderIconEl?.remove();
			} else {
				const arrowColor = rule.icon || rule.iconDefault ? null : rule.color;
				this.refreshIcon({ icon: null, color: arrowColor }, iconEl);
				folderIconEl = folderIconEl ?? selfEl.createDiv({ cls: 'iconic-sidekick' });
				if (iconEl.nextElementSibling !== folderIconEl) {
					iconEl.insertAdjacentElement('afterend', folderIconEl);
				}
				iconEl = folderIconEl;
			}

			if (iconEl.hasClass('collapse-icon') && !rule.icon && !rule.iconDefault) {
				this.refreshIcon(rule, iconEl); // Skip click listener if icon will be a collapse arrow
			} else if (this.plugin.isSettingEnabled('clickableIcons')) {
				this.refreshIcon(rule, iconEl, event => {
					IconPicker.openSingle(this.plugin, file, (newIcon, newColor) => {
						this.plugin.saveFileIcon(file, newIcon, newColor);
						this.plugin.refreshManagers('file', 'folder');
					});
					event.stopPropagation();
				});
			} else {
				this.refreshIcon(rule, iconEl);
			}

			// Update ghost icon when dragging
			this.setEventListener(selfEl, 'dragstart', () => {
				if (rule.icon || rule.iconDefault || rule.color) {
					const ghostEl = activeDocument.body.find(':scope > .drag-ghost > .drag-ghost-self');
					if (ghostEl) {
						const spanEl = ghostEl.find('span');
						const ghostIcon = (file.category === 'folder' && rule.icon === null)
							? 'lucide-folder-open'
							: rule.icon || rule.iconDefault;
						this.refreshIcon({ icon: ghostIcon, color: rule.color }, ghostEl);
						ghostEl.appendChild(spanEl);
					}
				}
			});
		}
	}

	/**
	 * Debounced version of refreshChildIcons that prevents multiple rapid refreshes.
	 * Waits for 100ms of no new refresh requests before executing.
	 */
	private debouncedRefresh(files: FileItem[], itemEls: HTMLElement[]): void {
		window.clearTimeout(this.refreshTimerId);
		this.refreshTimerId = window.setTimeout(() => {
			this.refreshChildIcons(files, itemEls);
		}, 100);
	}

	/**
	 * When user context-clicks a file, or opens a file pane menu, add custom items to the menu.
	 */
	private onContextMenu(...fileIds: string[]): void {
		this.plugin.menuManager.closeAndFlush();
		const files: FileItem[] = [];
		for (const fileId of fileIds) {
			files.push(this.plugin.getFileItem(fileId));
		}

		// Change icon(s)
		const changeTitle = files.length === 1
			? STRINGS.menu.changeIcon
			: STRINGS.menu.changeIcons.replace('{#}', files.length.toString());
		this.plugin.menuManager.addItemAfter(['action-primary', 'close', 'open'], item => item
			.setTitle(changeTitle)
			.setIcon('lucide-image-plus')
			.setSection('icon')
			.onClick(() => {
				if (files.length === 1) {
					IconPicker.openSingle(this.plugin, files[0], (newIcon, newColor) => {
						this.plugin.saveFileIcon(files[0], newIcon, newColor);
						this.plugin.refreshManagers('file', 'folder');
					});
				} else {
					IconPicker.openMulti(this.plugin, files, (newIcon, newColor) => {
						this.plugin.saveFileIcons(files, newIcon, newColor);
						this.plugin.refreshManagers('file', 'folder');
					});
				}
			})
		);

		// Remove icon(s) / Reset color(s)
		const anyIcons = files.some(file => file.icon);
		const anyColors = files.some(file => file.color);
		const removalTitle = files.length === 1
			? files[0].icon
				? STRINGS.menu.removeIcon
				: STRINGS.menu.resetColor
			: anyIcons
				? STRINGS.menu.removeIcons.replace('{#}', files.length.toString())
				: STRINGS.menu.resetColors.replace('{#}', files.length.toString())
		const removalIcon = anyIcons ? 'lucide-image-minus' : 'lucide-rotate-ccw';
		if (anyIcons || anyColors) {
			this.plugin.menuManager.addItem(item => item
				.setTitle(removalTitle)
				.setIcon(removalIcon)
				.setSection('icon')
				.onClick(() => {
					if (files.length === 1) {
						this.plugin.saveFileIcon(files[0], null, null);
					} else {
						this.plugin.saveFileIcons(files, null, null);
					}
					this.plugin.refreshManagers('file', 'folder');
				})
			);
		}

		// Edit rule
		if (files.length === 1) {
			const page = files[0].items ? 'folder' : 'file';
			const rule = this.plugin.ruleManager.checkRuling(page, files[0].id);
			if (rule) {
				this.plugin.menuManager.addItem(item => { item
					.setTitle(STRINGS.menu.editRule)
					.setIcon('lucide-image-play')
					.setSection('icon')
					.onClick(() => RuleEditor.open(this.plugin, page, rule, newRule => {
						const isRulingChanged = newRule
							? this.plugin.ruleManager.saveRule(page, newRule)
							: this.plugin.ruleManager.deleteRule(page, rule.id);
						if (isRulingChanged) {
							this.refreshIcons();
							this.plugin.refreshManagers(page);
						}
					}));
				});
			}
		}
	}

	/**
	 * @override
	 * Clear refresh timer in addition to standard cleanup.
	 */
	unload(): void {
		window.clearTimeout(this.refreshTimerId);
		this.refreshIcons(true);
		super.unload();
	}
}
