import type { TrackerConfig, TrackedEvent } from './types';

function resolvePath(path: string): { obj: any; key: string } {
  const parts = path.split('.');
  let obj: any = window;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'window') continue;
    obj = obj?.[parts[i]];
    if (!obj) return { obj: null, key: '' };
  }
  return { obj, key: parts[parts.length - 1] };
}

function extractByRule(args: any[], rule?: string): any {
  if (!rule) return undefined;
  const match = rule.match(/^args\[(\d+)\]$/);
  if (match) return args[parseInt(match[1])];
  return undefined;
}

export class EventTracker {
  private events: TrackedEvent[] = [];
  private currentStepIndex = 0;
  private originals: Map<string, Function> = new Map();

  install(trackers: TrackerConfig[]): void {
    for (const t of trackers) {
      this.hookTarget(t);
    }
  }

  private hookTarget(config: TrackerConfig): void {
    const { obj, key } = resolvePath(config.target);
    if (!obj || typeof obj[key] !== 'function') return;

    const original = obj[key];
    this.originals.set(config.target, original);

    const self = this;
    obj[key] = function (this: any, ...args: any[]) {
      const event = extractByRule(args, config.extractEvent);
      const params = extractByRule(args, config.extractParams);

      if (event && typeof event === 'string') {
        self.events.push({
          sdk: config.name,
          event,
          params: (params && typeof params === 'object') ? params : {},
          timestamp: Date.now(),
          stepIndex: self.currentStepIndex,
        });
      }
      return original.apply(this, args);
    };
  }

  setStepIndex(index: number): void { this.currentStepIndex = index; }
  getEvents(): TrackedEvent[] { return [...this.events]; }

  getEventsByName(sdk: string, event: string): TrackedEvent[] {
    return this.events.filter(e => e.sdk === sdk && e.event === event);
  }

  clear(): void { this.events = []; }

  uninstall(): void {
    for (const [target, original] of this.originals) {
      const { obj, key } = resolvePath(target);
      if (obj) obj[key] = original;
    }
    this.originals.clear();
  }
}

export const tracker = new EventTracker();
