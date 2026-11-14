import './style.css';
import { Engine } from './core/Engine';
import { HUDController } from './ui/HUDController';

function bootstrap(): void {
  const canvasContainer = document.getElementById('canvas-container');
  const hudRoot = document.getElementById('hud-root');

  if (!canvasContainer || !hudRoot) {
    throw new Error('Missing #canvas-container or #hud-root in DOM');
  }

  const engine = new Engine(canvasContainer);
  const hud = new HUDController(hudRoot, engine);

  engine.setTelemetryListener((telemetry) => {
    hud.updateTelemetry(telemetry);
  });

  engine.start();

  window.addEventListener('beforeunload', () => {
    hud.dispose();
    engine.dispose();
  });
}

bootstrap();
