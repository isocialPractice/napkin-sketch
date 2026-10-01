/**
 * Settings window controller.
 *
 * Renders the configurable application settings, reads/writes them through the
 * `window.napkin` bridge (which persists them in the main process), and updates
 * live as the user edits each control. It shares `styles.css` with the main
 * window and reuses the same IPC bridge, so no extra preload is required.
 */

import '../core/ipc.js';
import type { HistoryStats } from '../core/ipc.js';
import {
  defaultSettings,
  SETTINGS_LIMITS,
  type AppSettings,
  type AppTheme,
  type MenuPlacement,
  type QuickModifier,
} from '../core/settings.js';
import { historyUsage } from './history-tracker.js';

/** Looks up a required element by id, throwing a clear error if absent. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

class SettingsApp {
  private settings: AppSettings = defaultSettings();
  private toastTimer: number | null = null;
  /** How much history the drawing window holds, as it last said. */
  private historyStats: HistoryStats | null = null;

  async start(): Promise<void> {
    try {
      this.settings = await window.napkin.getSettings();
    } catch {
      this.toast('Settings are only available in the desktop app.');
    }
    this.configureRanges();
    this.bind();
    this.render();
    document.documentElement.dataset.theme = this.settings.theme;

    try {
      window.napkin.onSettingsChanged((settings) => {
        this.settings = settings;
        this.render();
        document.documentElement.dataset.theme = settings.theme;
      });
    } catch {
      // running outside Electron — live sync unavailable
    }

    // Track History's figures come from the drawing window, through the main process.
    try {
      window.napkin.onHistoryStatsChanged((stats) => {
        this.historyStats = stats;
        this.renderHistoryUsage();
      });
      window.napkin.onShowSettingsSection((section) => this.showSection(section));
      this.historyStats = await window.napkin.getHistoryStats();
    } catch {
      // running outside Electron — no drawing window to ask
    }
    this.renderHistoryUsage();
    // Opened for a section - Automate > History Limit opens Automate - it starts there.
    if (location.hash.length > 1) this.showSection(location.hash.slice(1));
  }

  /** Brings a section into view and puts the focus on its first control. */
  private showSection(id: string): void {
    const section = document.getElementById(id);
    if (!section || !section.classList.contains('settings-section')) return;
    section.scrollIntoView({ block: 'start' });
    section.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
  }

  /** Applies min/max/step from the shared limits to each range input. */
  private configureRanges(): void {
    const lim = SETTINGS_LIMITS;
    this.setRange('zoom-sensitivity', lim.zoomSensitivity);
    this.setRange('pan-sensitivity', lim.panSensitivity);
    this.setRange('quick-timer', lim.quickTimerMs);
    this.setRange('endpoint-snap-px', lim.endpointSnapPx);
    this.setRange('select-px', lim.selectSensitivityPx);
    this.setRange('eyedrop-px', lim.eyedropSensitivityPx);
    this.setRange('freehand-fidelity', lim.freehandFidelityPx);
    this.setRange('direct-select-px', lim.directSelectSensitivityPx);
    this.setRange('qs-wobble', lim.sharpenWobble);
    this.setRange('qs-smoothing', lim.sharpenSmoothing);
    this.setRange('qs-circle', lim.sharpenCircleSnap);
    this.setRange('qs-symmetry', lim.symmetry);
    this.setRange('qs-textsize', lim.textSize);
    this.setRange('quick-color-count', lim.quickColorCount);
    this.setRange('autosave', lim.autoSaveIntervalSec);
    this.setRange('copic-hold', lim.copicHoldSec);
    this.setRange('copic-speed', lim.copicRotateSpeedDeg);
    this.setRange('copic-width-mult', lim.copicWidthMultiplier);
    this.setRange('history-limit', lim.historyLimit);
  }

  private setRange(id: string, lim: { min: number; max: number; step: number }): void {
    const input = el<HTMLInputElement>(id);
    input.min = String(lim.min);
    input.max = String(lim.max);
    input.step = String(lim.step);
  }

  // ---- Persistence ---------------------------------------------------------

  /** Sends a settings patch to the main process and adopts the result. */
  private async patch(patch: Partial<AppSettings>): Promise<void> {
    try {
      this.settings = await window.napkin.updateSettings(patch);
    } catch {
      this.settings = { ...this.settings, ...patch };
    }
    this.render();
    document.documentElement.dataset.theme = this.settings.theme;
  }

  // ---- Bindings ------------------------------------------------------------

  private bind(): void {
    el<HTMLInputElement>('zoom-sensitivity').addEventListener('input', (e) =>
      this.patch({ zoomSensitivity: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('pan-sensitivity').addEventListener('input', (e) =>
      this.patch({ panSensitivity: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('invert-zoom').addEventListener('change', (e) =>
      this.patch({ invertZoom: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('invert-scroll-zoom').addEventListener('change', (e) =>
      this.patch({ invertScrollZoom: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('invert-scroll-pan').addEventListener('change', (e) =>
      this.patch({ invertScrollPan: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('invert-pan-drag').addEventListener('change', (e) =>
      this.patch({ invertPanDrag: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('quick-timer').addEventListener('input', (e) =>
      this.patch({ quickTimerMs: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('endpoint-snap').addEventListener('change', (e) =>
      this.patch({ endpointSnap: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('endpoint-snap-px').addEventListener('input', (e) =>
      this.patch({ endpointSnapPx: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('join-stroke').addEventListener('change', (e) =>
      this.patch({ joinStrokeOnSnap: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('wipe-animation').addEventListener('change', (e) =>
      this.patch({ wipeAnimation: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('select-px').addEventListener('input', (e) =>
      this.patch({ selectSensitivityPx: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('eyedrop-px').addEventListener('input', (e) =>
      this.patch({ eyedropSensitivityPx: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('freehand-fidelity').addEventListener('input', (e) =>
      this.patch({ freehandFidelityPx: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('direct-select-px').addEventListener('input', (e) =>
      this.patch({ directSelectSensitivityPx: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('show-selection-borders').addEventListener('change', (e) =>
      this.patch({ showSelectionBorders: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('warp-show-mesh').addEventListener('change', (e) =>
      this.patch({ warpShowMesh: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('qs-live-sharpen').addEventListener('change', (e) =>
      this.patch({ liveSharpen: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('qs-wobble').addEventListener('input', (e) =>
      this.patch({ sharpenWobble: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('qs-smoothing').addEventListener('input', (e) =>
      this.patch({ sharpenSmoothing: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('qs-circle').addEventListener('input', (e) =>
      this.patch({ sharpenCircleSnap: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('qs-taper').addEventListener('change', (e) =>
      this.patch({ sharpenTaperEnds: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('qs-symmetry').addEventListener('input', (e) =>
      this.patch({ symmetry: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('qs-textsize').addEventListener('input', (e) =>
      this.patch({ textSize: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('quick-color-count').addEventListener('input', (e) =>
      this.patch({ quickColorCount: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLSelectElement>('menu-placement').addEventListener('change', (e) =>
      this.patch({ menuPlacement: (e.target as HTMLSelectElement).value as MenuPlacement }),
    );
    el<HTMLSelectElement>('theme').addEventListener('change', (e) =>
      this.patch({ theme: (e.target as HTMLSelectElement).value as AppTheme }),
    );
    el<HTMLInputElement>('autosave').addEventListener('input', (e) =>
      this.patch({ autoSaveIntervalSec: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('remember').addEventListener('change', (e) =>
      this.patch({ rememberSettings: (e.target as HTMLInputElement).checked }),
    );

    el<HTMLInputElement>('copic-quick').addEventListener('change', (e) =>
      this.patch({ copicQuickRotate: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('copic-hold').addEventListener('input', (e) =>
      this.patch({ copicHoldSec: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('copic-speed').addEventListener('input', (e) =>
      this.patch({ copicRotateSpeedDeg: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('copic-width-mult').addEventListener('input', (e) =>
      this.patch({ copicWidthMultiplier: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLSelectElement>('copic-hold-key').addEventListener('change', (e) =>
      this.patch({ copicHoldKey: (e.target as HTMLSelectElement).value as QuickModifier }),
    );
    el<HTMLSelectElement>('copic-cw-key').addEventListener('change', (e) =>
      this.patch({ copicRotateCwKey: (e.target as HTMLSelectElement).value as QuickModifier }),
    );
    el<HTMLSelectElement>('copic-ccw-key').addEventListener('change', (e) =>
      this.patch({ copicRotateCcwKey: (e.target as HTMLSelectElement).value as QuickModifier }),
    );

    el<HTMLInputElement>('track-history').addEventListener('change', (e) =>
      this.patch({ trackHistory: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('history-limit').addEventListener('input', (e) =>
      this.patch({ historyLimit: Number((e.target as HTMLInputElement).value) }),
    );

    el('rearrange-btn').addEventListener('click', () => {
      try {
        window.napkin.toggleRearrange();
        this.toast('Toggled rearrange mode in the main window.');
      } catch {
        this.toast('Rearrange mode is only available in the desktop app.');
      }
    });

    el('export-btn').addEventListener('click', async () => {
      try {
        const result = await window.napkin.exportSettings();
        if (result.cancelled) return;
        this.toast(result.ok ? 'Saved settings to JSON.' : result.error ?? 'Could not save settings.');
      } catch {
        this.toast('Export is only available in the desktop app.');
      }
    });

    el('import-btn').addEventListener('click', async () => {
      try {
        const loaded = await window.napkin.importSettings();
        if (loaded) {
          this.settings = loaded;
          this.render();
          this.toast('Loaded settings from JSON.');
        }
      } catch {
        this.toast('Import is only available in the desktop app.');
      }
    });

    el('reset-btn').addEventListener('click', () => {
      void this.patch(defaultSettings());
      this.toast('Settings reset to defaults.');
    });
  }

  // ---- Rendering -----------------------------------------------------------

  /** Reflects the current settings into every control. */
  private render(): void {
    const s = this.settings;
    this.setValue('zoom-sensitivity', s.zoomSensitivity);
    el('zoom-sensitivity-value').textContent = s.zoomSensitivity.toFixed(2);
    this.setValue('pan-sensitivity', s.panSensitivity);
    el('pan-sensitivity-value').textContent = s.panSensitivity.toFixed(2);
    el<HTMLInputElement>('invert-zoom').checked = s.invertZoom;
    el<HTMLInputElement>('invert-scroll-zoom').checked = s.invertScrollZoom;
    el<HTMLInputElement>('invert-scroll-pan').checked = s.invertScrollPan;
    el<HTMLInputElement>('invert-pan-drag').checked = s.invertPanDrag;

    this.setValue('quick-timer', s.quickTimerMs);
    el('quick-timer-value').textContent = `${(s.quickTimerMs / 1000).toFixed(1)}s`;

    el<HTMLInputElement>('endpoint-snap').checked = s.endpointSnap;
    this.setValue('endpoint-snap-px', s.endpointSnapPx);
    el('endpoint-snap-px-value').textContent = `${s.endpointSnapPx}px`;
    el<HTMLInputElement>('join-stroke').checked = s.joinStrokeOnSnap;
    el<HTMLInputElement>('wipe-animation').checked = s.wipeAnimation;

    this.setValue('select-px', s.selectSensitivityPx);
    el('select-px-value').textContent = `${s.selectSensitivityPx}px`;
    this.setValue('freehand-fidelity', s.freehandFidelityPx);
    el('freehand-fidelity-value').textContent = `${s.freehandFidelityPx}px`;
    this.setValue('eyedrop-px', s.eyedropSensitivityPx);
    el('eyedrop-px-value').textContent = `${s.eyedropSensitivityPx}px`;
    this.setValue('direct-select-px', s.directSelectSensitivityPx);
    el('direct-select-px-value').textContent = `${s.directSelectSensitivityPx}px`;
    el<HTMLInputElement>('show-selection-borders').checked = s.showSelectionBorders;
    el<HTMLInputElement>('warp-show-mesh').checked = s.warpShowMesh;

    el<HTMLInputElement>('qs-live-sharpen').checked = s.liveSharpen;
    this.setValue('qs-wobble', s.sharpenWobble);
    el('qs-wobble-value').textContent = s.sharpenWobble.toFixed(1);
    this.setValue('qs-smoothing', s.sharpenSmoothing);
    el('qs-smoothing-value').textContent = s.sharpenSmoothing.toFixed(1);
    this.setValue('qs-circle', s.sharpenCircleSnap);
    el('qs-circle-value').textContent = s.sharpenCircleSnap.toFixed(2);
    el<HTMLInputElement>('qs-taper').checked = s.sharpenTaperEnds;
    this.setValue('qs-symmetry', s.symmetry);
    el('qs-symmetry-value').textContent = s.symmetry > 1 ? `${s.symmetry}×` : 'off';
    this.setValue('qs-textsize', s.textSize);
    el('qs-textsize-value').textContent = `${s.textSize}px`;

    this.setValue('quick-color-count', s.quickColorCount);
    el('quick-color-count-value').textContent = String(s.quickColorCount);
    this.renderColors();

    el<HTMLSelectElement>('menu-placement').value = s.menuPlacement;
    el<HTMLSelectElement>('theme').value = s.theme;

    this.setValue('autosave', s.autoSaveIntervalSec);
    el('autosave-value').textContent =
      s.autoSaveIntervalSec > 0 ? `every ${s.autoSaveIntervalSec}s` : 'off';

    el<HTMLInputElement>('remember').checked = s.rememberSettings;

    el<HTMLInputElement>('copic-quick').checked = s.copicQuickRotate;
    this.setValue('copic-hold', s.copicHoldSec);
    el('copic-hold-value').textContent = `${s.copicHoldSec.toFixed(1)}s`;
    this.setValue('copic-speed', s.copicRotateSpeedDeg);
    el('copic-speed-value').textContent = `${s.copicRotateSpeedDeg}°/s`;
    this.setValue('copic-width-mult', s.copicWidthMultiplier);
    el('copic-width-mult-value').textContent = `${s.copicWidthMultiplier.toFixed(2)}×`;
    el<HTMLSelectElement>('copic-hold-key').value = s.copicHoldKey;
    el<HTMLSelectElement>('copic-cw-key').value = s.copicRotateCwKey;
    el<HTMLSelectElement>('copic-ccw-key').value = s.copicRotateCcwKey;

    el<HTMLInputElement>('track-history').checked = s.trackHistory;
    this.setValue('history-limit', s.historyLimit);
    el('history-limit-value').textContent = `${s.historyLimit} steps`;
  }

  /** The line under the History Limit: the steps held and what they cost, or that tracking is off. */
  private renderHistoryUsage(): void {
    el('history-usage').textContent = historyUsage(this.historyStats);
  }

  private setValue(id: string, value: number): void {
    el<HTMLInputElement>(id).value = String(value);
  }

  /** Renders the editable swatches for the quick-access colors. */
  private renderColors(): void {
    const host = el('quick-colors');
    host.textContent = '';
    this.settings.quickColors.forEach((color, index) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = color;
      input.className = 'settings-color';
      input.title = `Quick color ${index + 1}`;
      input.setAttribute('aria-label', `Quick color ${index + 1}`);
      input.addEventListener('input', () => {
        const next = this.settings.quickColors.slice();
        next[index] = input.value;
        void this.patch({ quickColors: next });
      });
      host.appendChild(input);
    });
  }

  private toast(message: string): void {
    const toast = el('settings-toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new SettingsApp();
  void app.start();
});
