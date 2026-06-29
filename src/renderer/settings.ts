/**
 * Settings window controller.
 *
 * Renders the configurable application settings, reads/writes them through the
 * `window.napkin` bridge (which persists them in the main process), and updates
 * live as the user edits each control. It shares `styles.css` with the main
 * window and reuses the same IPC bridge, so no extra preload is required.
 */

import '../core/ipc.js';
import {
  defaultSettings,
  SETTINGS_LIMITS,
  type AppSettings,
  type AppTheme,
  type MenuPlacement,
} from '../core/settings.js';

/** Looks up a required element by id, throwing a clear error if absent. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

class SettingsApp {
  private settings: AppSettings = defaultSettings();
  private toastTimer: number | null = null;

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
  }

  /** Applies min/max/step from the shared limits to each range input. */
  private configureRanges(): void {
    const lim = SETTINGS_LIMITS;
    this.setRange('zoom-sensitivity', lim.zoomSensitivity);
    this.setRange('pan-sensitivity', lim.panSensitivity);
    this.setRange('quick-timer', lim.quickTimerMs);
    this.setRange('quick-color-count', lim.quickColorCount);
    this.setRange('autosave', lim.autoSaveIntervalSec);
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
    el<HTMLInputElement>('quick-timer').addEventListener('input', (e) =>
      this.patch({ quickTimerMs: Number((e.target as HTMLInputElement).value) }),
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

    this.setValue('quick-timer', s.quickTimerMs);
    el('quick-timer-value').textContent = `${(s.quickTimerMs / 1000).toFixed(1)}s`;

    this.setValue('quick-color-count', s.quickColorCount);
    el('quick-color-count-value').textContent = String(s.quickColorCount);
    this.renderColors();

    el<HTMLSelectElement>('menu-placement').value = s.menuPlacement;
    el<HTMLSelectElement>('theme').value = s.theme;

    this.setValue('autosave', s.autoSaveIntervalSec);
    el('autosave-value').textContent =
      s.autoSaveIntervalSec > 0 ? `every ${s.autoSaveIntervalSec}s` : 'off';

    el<HTMLInputElement>('remember').checked = s.rememberSettings;
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
