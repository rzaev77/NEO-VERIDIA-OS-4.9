import { Engine } from '../core/Engine';
import { CameraMode, FollowSubMode, TelemetryData, TimeOfDayPreset } from '../types';

export class HUDController {
  private readonly root: HTMLElement;
  private readonly engine: Engine;

  // Telemetry DOM refs
  private fpsEl!: HTMLElement;
  private agentsEl!: HTMLElement;
  private drawCallsEl!: HTMLElement;
  private trianglesEl!: HTMLElement;
  private statusBadgeEl!: HTMLElement;
  private gridPercentEl!: HTMLElement;
  private districtCells: HTMLElement[] = [];

  // Taxi HUD DOM refs
  private taxiPanelEl!: HTMLElement;
  private taxiIdEl!: HTMLElement;
  private taxiSpeedEl!: HTMLElement;
  private taxiAltEl!: HTMLElement;
  private taxiViewLabelEl!: HTMLElement;

  // Controls DOM refs
  private presetButtons = new Map<TimeOfDayPreset, HTMLButtonElement>();
  private trafficSlider!: HTMLInputElement;
  private trafficValEl!: HTMLElement;
  private speedSlider!: HTMLInputElement;
  private speedValEl!: HTMLElement;
  private rainSlider!: HTMLInputElement;
  private rainValEl!: HTMLElement;
  private windSlider!: HTMLInputElement;
  private windValEl!: HTMLElement;
  private fogSlider!: HTMLInputElement;
  private fogValEl!: HTMLElement;
  private blackoutBtn!: HTMLButtonElement;
  private camOrbitBtn!: HTMLButtonElement;
  private camFollowBtn!: HTMLButtonElement;
  private followChaseBtn!: HTMLButtonElement;
  private followCockpitBtn!: HTMLButtonElement;
  private nextAgentBtn!: HTMLButtonElement;
  private audioBtn!: HTMLButtonElement;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, engine: Engine) {
    this.root = root;
    this.engine = engine;
    this.render();
    this.bindEvents();

    this.onKeyDownBound = (e: KeyboardEvent) => this.handleHotkeys(e);
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  private render(): void {
    const p = this.engine.params;

    this.root.innerHTML = `
      <aside class="hud-panel hud-telemetry">
        <div class="hud-brand">
          <span class="hud-title">NEO-VERIDIA // OS 4.9</span>
          <span class="hud-badge" id="hud-grid-badge">GRID ONLINE</span>
        </div>

        <div class="telemetry-grid">
          <div class="metric">
            <span class="metric-label">FPS / Frame</span>
            <span class="metric-value cyan" id="tel-fps">60 (16.6ms)</span>
          </div>
          <div class="metric">
            <span class="metric-label">Active Spinners</span>
            <span class="metric-value" id="tel-agents">${p.trafficCount}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Draw Calls</span>
            <span class="metric-value amber" id="tel-draws">0</span>
          </div>
          <div class="metric">
            <span class="metric-label">Triangles</span>
            <span class="metric-value" id="tel-tris">0</span>
          </div>
        </div>

        <div class="power-grid-section">
          <div class="section-caption">
            <span>POWER SECTORS [4x4]</span>
            <span id="grid-percent">100%</span>
          </div>
          <div class="district-matrix" id="district-matrix">
            ${Array.from({ length: 16 }, (_, i) => `<div class="district-cell" data-sector="${i}">S${String(i + 1).padStart(2, '0')}</div>`).join('')}
          </div>
        </div>
      </aside>

      <aside class="hud-panel hud-taxi hidden" id="hud-taxi-panel">
        <div class="taxi-header">
          <span>SPINNER TAXI TELEMETRY</span>
          <span id="taxi-view-label">3RD PERSON</span>
        </div>
        <div class="taxi-stats">
          <div class="metric">
            <span class="metric-label">UNIT ID</span>
            <span class="metric-value cyan" id="taxi-id">#001</span>
          </div>
          <div class="metric">
            <span class="metric-label">VELOCITY</span>
            <span class="metric-value" id="taxi-speed">0 km/h</span>
          </div>
          <div class="metric">
            <span class="metric-label">ALTITUDE</span>
            <span class="metric-value amber" id="taxi-alt">22 m</span>
          </div>
        </div>
        <div class="taxi-hint">
          [N] Сменить спинер &nbsp;•&nbsp; [V] Кабина / Внешний вид &nbsp;•&nbsp; [C] Выход
        </div>
      </aside>

      <aside class="hud-panel hud-controls" id="hud-controls-panel">
        <div class="controls-header">
          <h2>CITY CONTROL MATRIX</h2>
          <button class="btn-mini" id="btn-collapse">HIDE</button>
        </div>

        <div class="control-body">
          <div class="control-group">
            <div class="group-title">01 // Атмосфера и время суток</div>
            <div class="btn-row cols-3">
              <button class="cyber-btn active" data-preset="deep_night">Глубокая ночь</button>
              <button class="cyber-btn" data-preset="toxic_dawn">Токсичный рассвет</button>
              <button class="cyber-btn" data-preset="acid_rain">Кислотный дождь</button>
            </div>
          </div>

          <div class="control-group">
            <div class="group-title">02 // Воздушный трафик</div>
            <div class="slider-row">
              <div class="slider-label">
                <span>Плотность спинеров</span>
                <span id="val-traffic">${p.trafficCount}</span>
              </div>
              <input type="range" id="sl-traffic" min="50" max="500" step="10" value="${p.trafficCount}" />
            </div>
            <div class="slider-row">
              <div class="slider-label">
                <span>Макс. скорость потока</span>
                <span id="val-speed">${p.trafficMaxSpeed} м/с</span>
              </div>
              <input type="range" id="sl-speed" min="20" max="120" step="1" value="${p.trafficMaxSpeed}" />
            </div>
          </div>

          <div class="control-group">
            <div class="group-title">03 // Динамическая погода</div>
            <div class="slider-row">
              <div class="slider-label">
                <span>Интенсивность дождя</span>
                <span id="val-rain">${Math.round(p.rainIntensity * 100)}%</span>
              </div>
              <input type="range" id="sl-rain" min="0" max="1" step="0.01" value="${p.rainIntensity}" />
            </div>
            <div class="slider-row">
              <div class="slider-label">
                <span>Боковой ветер</span>
                <span id="val-wind">${p.windForce.toFixed(2)}</span>
              </div>
              <input type="range" id="sl-wind" min="-1" max="1" step="0.02" value="${p.windForce}" />
            </div>
            <div class="slider-row">
              <div class="slider-label">
                <span>Плотность тумана (FogExp2)</span>
                <span id="val-fog">${(p.fogDensity * 1000).toFixed(2)}</span>
              </div>
              <input type="range" id="sl-fog" min="0.0005" max="0.008" step="0.0001" value="${p.fogDensity}" />
            </div>
          </div>

          <div class="control-group">
            <div class="group-title">04 // Энергосистема</div>
            <button class="cyber-btn danger" id="btn-blackout">
              ⚡ АВАРИЙНЫЙ БЛЭКАУТ [B]
            </button>
          </div>

          <div class="control-group">
            <div class="group-title">05 // Камеры и звук</div>
            <div class="btn-row cols-2">
              <button class="cyber-btn active" id="btn-cam-orbit">Свободный облет</button>
              <button class="cyber-btn magenta" id="btn-cam-follow">Режим такси</button>
            </div>
            <div class="btn-row cols-2">
              <button class="cyber-btn active" id="btn-sub-chase">От 3-го лица</button>
              <button class="cyber-btn magenta" id="btn-sub-cockpit">Из кабины</button>
            </div>
            <div class="btn-row cols-2">
              <button class="cyber-btn" id="btn-next-agent">След. спинер [N]</button>
              <button class="cyber-btn" id="btn-audio">Звук: ВЫКЛ [M]</button>
            </div>
            <div class="hotkey-help">
              <b>WASD / Q / E</b> полет &nbsp;•&nbsp; <b>Shift</b> форсаж &nbsp;•&nbsp; <b>C</b> камера &nbsp;•&nbsp; <b>V</b> кабина &nbsp;•&nbsp; <b>N</b> борт
            </div>
          </div>
        </div>
      </aside>
    `;

    this.fpsEl = this.root.querySelector('#tel-fps')!;
    this.agentsEl = this.root.querySelector('#tel-agents')!;
    this.drawCallsEl = this.root.querySelector('#tel-draws')!;
    this.trianglesEl = this.root.querySelector('#tel-tris')!;
    this.statusBadgeEl = this.root.querySelector('#hud-grid-badge')!;
    this.gridPercentEl = this.root.querySelector('#grid-percent')!;
    this.districtCells = Array.from(this.root.querySelectorAll('.district-cell'));

    this.taxiPanelEl = this.root.querySelector('#hud-taxi-panel')!;
    this.taxiIdEl = this.root.querySelector('#taxi-id')!;
    this.taxiSpeedEl = this.root.querySelector('#taxi-speed')!;
    this.taxiAltEl = this.root.querySelector('#taxi-alt')!;
    this.taxiViewLabelEl = this.root.querySelector('#taxi-view-label')!;

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      const preset = btn.dataset.preset as TimeOfDayPreset;
      this.presetButtons.set(preset, btn);
    });

    this.trafficSlider = this.root.querySelector('#sl-traffic')!;
    this.trafficValEl = this.root.querySelector('#val-traffic')!;
    this.speedSlider = this.root.querySelector('#sl-speed')!;
    this.speedValEl = this.root.querySelector('#val-speed')!;
    this.rainSlider = this.root.querySelector('#sl-rain')!;
    this.rainValEl = this.root.querySelector('#val-rain')!;
    this.windSlider = this.root.querySelector('#sl-wind')!;
    this.windValEl = this.root.querySelector('#val-wind')!;
    this.fogSlider = this.root.querySelector('#sl-fog')!;
    this.fogValEl = this.root.querySelector('#val-fog')!;

    this.blackoutBtn = this.root.querySelector('#btn-blackout')!;
    this.camOrbitBtn = this.root.querySelector('#btn-cam-orbit')!;
    this.camFollowBtn = this.root.querySelector('#btn-cam-follow')!;
    this.followChaseBtn = this.root.querySelector('#btn-sub-chase')!;
    this.followCockpitBtn = this.root.querySelector('#btn-sub-cockpit')!;
    this.nextAgentBtn = this.root.querySelector('#btn-next-agent')!;
    this.audioBtn = this.root.querySelector('#btn-audio')!;
  }

  private bindEvents(): void {
    const controlsPanel = this.root.querySelector('#hud-controls-panel')!;
    const collapseBtn = this.root.querySelector('#btn-collapse') as HTMLButtonElement;
    collapseBtn.addEventListener('click', () => {
      const collapsed = controlsPanel.classList.toggle('collapsed');
      collapseBtn.textContent = collapsed ? 'SHOW' : 'HIDE';
    });

    this.presetButtons.forEach((btn, preset) => {
      btn.addEventListener('click', () => this.selectPreset(preset));
    });

    this.trafficSlider.addEventListener('input', () => {
      const val = Number(this.trafficSlider.value);
      this.trafficValEl.textContent = String(val);
      this.engine.setTrafficCount(val);
    });

    this.speedSlider.addEventListener('input', () => {
      const val = Number(this.speedSlider.value);
      this.speedValEl.textContent = `${val} м/с`;
      this.engine.setTrafficMaxSpeed(val);
    });

    this.rainSlider.addEventListener('input', () => {
      const val = Number(this.rainSlider.value);
      this.rainValEl.textContent = `${Math.round(val * 100)}%`;
      this.engine.setRainIntensity(val);
    });

    this.windSlider.addEventListener('input', () => {
      const val = Number(this.windSlider.value);
      this.windValEl.textContent = val.toFixed(2);
      this.engine.setWindForce(val);
    });

    this.fogSlider.addEventListener('input', () => {
      const val = Number(this.fogSlider.value);
      this.fogValEl.textContent = (val * 1000).toFixed(2);
      this.engine.setFogDensity(val);
    });

    this.blackoutBtn.addEventListener('click', () => {
      this.engine.triggerBlackout();
    });

    this.camOrbitBtn.addEventListener('click', () => this.setCameraMode('orbit'));
    this.camFollowBtn.addEventListener('click', () => this.setCameraMode('follow'));

    this.followChaseBtn.addEventListener('click', () => this.setFollowSubMode('chase'));
    this.followCockpitBtn.addEventListener('click', () => this.setFollowSubMode('cockpit'));

    this.nextAgentBtn.addEventListener('click', () => {
      if (this.engine.params.cameraMode !== 'follow') {
        this.setCameraMode('follow');
      }
      this.engine.nextFollowedAgent();
    });

    this.audioBtn.addEventListener('click', () => {
      void this.toggleAudio();
    });
  }

  private selectPreset(preset: TimeOfDayPreset): void {
    this.engine.setPreset(preset);
    this.presetButtons.forEach((btn, key) => {
      btn.classList.toggle('active', key === preset);
    });

    // Sync sliders to preset defaults
    const p = this.engine.params;
    this.rainSlider.value = String(p.rainIntensity);
    this.rainValEl.textContent = `${Math.round(p.rainIntensity * 100)}%`;

    this.windSlider.value = String(p.windForce);
    this.windValEl.textContent = p.windForce.toFixed(2);

    this.fogSlider.value = String(p.fogDensity);
    this.fogValEl.textContent = (p.fogDensity * 1000).toFixed(2);
  }

  private setCameraMode(mode: CameraMode): void {
    this.engine.setCameraMode(mode);
    this.camOrbitBtn.classList.toggle('active', mode === 'orbit');
    this.camFollowBtn.classList.toggle('active', mode === 'follow');
  }

  private setFollowSubMode(subMode: FollowSubMode): void {
    if (this.engine.params.cameraMode !== 'follow') {
      this.setCameraMode('follow');
    }
    this.engine.setFollowSubMode(subMode);
    this.followChaseBtn.classList.toggle('active', subMode === 'chase');
    this.followCockpitBtn.classList.toggle('active', subMode === 'cockpit');
  }

  private async toggleAudio(): Promise<void> {
    const on = await this.engine.toggleAudio();
    this.audioBtn.textContent = on ? 'Звук: ВКЛ [M]' : 'Звук: ВЫКЛ [M]';
    this.audioBtn.classList.toggle('audio-on', on);
  }

  private handleHotkeys(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (e.code === 'KeyN' || e.code === 'Tab') {
      e.preventDefault();
      if (this.engine.params.cameraMode !== 'follow') {
        this.setCameraMode('follow');
      } else {
        this.engine.nextFollowedAgent();
      }
    } else if (e.code === 'KeyV') {
      const sub = this.engine.toggleFollowSubMode();
      if (this.engine.params.cameraMode !== 'follow') {
        this.setCameraMode('follow');
      }
      this.followChaseBtn.classList.toggle('active', sub === 'chase');
      this.followCockpitBtn.classList.toggle('active', sub === 'cockpit');
    } else if (e.code === 'KeyC') {
      const next: CameraMode = this.engine.params.cameraMode === 'orbit' ? 'follow' : 'orbit';
      this.setCameraMode(next);
    } else if (e.code === 'KeyB') {
      this.engine.triggerBlackout();
    } else if (e.code === 'KeyM') {
      void this.toggleAudio();
    }
  }

  public updateTelemetry(data: TelemetryData): void {
    this.fpsEl.textContent = `${data.fps} (${data.frameTimeMs.toFixed(1)}ms)`;
    this.agentsEl.textContent = String(data.activeAgents);
    this.drawCallsEl.textContent = String(data.drawCalls);
    this.trianglesEl.textContent = data.triangles.toLocaleString('en-US');

    // Power grid status
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const power = data.districtPower[i];
      sum += power;
      const cell = this.districtCells[i];
      if (!cell) continue;
      cell.classList.toggle('offline', power <= 0.05);
      cell.classList.toggle('flicker', power > 0.05 && power < 0.94);
    }
    const pct = Math.round((sum / 16) * 100);
    this.gridPercentEl.textContent = `${pct}%`;

    const inBlackout = data.blackoutPhase !== 'online';
    this.statusBadgeEl.classList.toggle('blackout', inBlackout);
    if (data.blackoutPhase === 'online') {
      this.statusBadgeEl.textContent = 'GRID ONLINE';
      this.blackoutBtn.disabled = false;
      this.blackoutBtn.textContent = '⚡ АВАРИЙНЫЙ БЛЭКАУТ [B]';
    } else if (data.blackoutPhase === 'failing') {
      this.statusBadgeEl.textContent = 'CASCADE FAILURE';
      this.blackoutBtn.disabled = true;
      this.blackoutBtn.textContent = '⚡ КАСКАДНОЕ ОТКЛЮЧЕНИЕ...';
    } else if (data.blackoutPhase === 'dark') {
      this.statusBadgeEl.textContent = 'BLACKOUT ACTIVE';
      this.blackoutBtn.disabled = true;
      this.blackoutBtn.textContent = '⚡ БЛЭКАУТ АКТИВЕН';
    } else {
      this.statusBadgeEl.textContent = 'REBOOTING GRID';
      this.blackoutBtn.disabled = true;
      this.blackoutBtn.textContent = '⚡ ВОССТАНОВЛЕНИЕ СЕТИ...';
    }

    // Taxi HUD visibility & sync
    const isFollow = data.cameraMode === 'follow';
    this.taxiPanelEl.classList.toggle('hidden', !isFollow);
    if (isFollow) {
      this.taxiIdEl.textContent = `#${String(data.followedAgentId).padStart(3, '0')}`;
      this.taxiSpeedEl.textContent = `${data.followedSpeedKmh} km/h`;
      this.taxiAltEl.textContent = `${data.followedAltitude} m`;
      this.taxiViewLabelEl.textContent =
        data.followSubMode === 'cockpit' ? 'COCKPIT VIEW' : '3RD PERSON';
    }

    this.camOrbitBtn.classList.toggle('active', !isFollow);
    this.camFollowBtn.classList.toggle('active', isFollow);
    this.followChaseBtn.classList.toggle('active', data.followSubMode === 'chase');
    this.followCockpitBtn.classList.toggle('active', data.followSubMode === 'cockpit');
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
  }
}
