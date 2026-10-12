import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
} from "pixi.js";
import carUrl from "../../../../assets/sprites/car.svg?url";
import crewUrl from "../../../../assets/sprites/crew.svg?url";
import type { PitStopEvent } from "../contracts/events";
import type { Settings } from "../state/settingsStore";
import { TimelineScheduler } from "./TimelineScheduler";
import { SceneLoop } from "./SceneLoop";
import type { ClipId } from "./AnimationCatalog";
import { MotionTimeline, carPose, crewPose } from "./MotionTimeline";
export interface SceneOptions {
  reduced: boolean;
  paused: boolean;
  fps: 30 | 60;
  theme: Settings["theme"];
}
export class PitLaneScene {
  app = new Application();
  scheduler = new TimelineScheduler();
  motion = new MotionTimeline();
  root = new Container();
  car = new Container();
  crew: Sprite[] = [];
  effects = new Graphics();
  board = new Text({
    text: "STAND BY",
    style: {
      fontFamily: "monospace",
      fontSize: 13,
      fontWeight: "bold",
      fill: 0xb9ed69,
    },
  });
  clock = 0;
  carVisible = false;
  private releasePending = false;
  options: SceneOptions = {
    reduced: false,
    paused: false,
    fps: 60,
    theme: "midnight",
  };
  alive = true;
  observer?: ResizeObserver;
  loop?: SceneLoop;
  dirty = true;
  private running = new Set<string>();
  get runningOperations() {
    return this.running;
  }
  set runningOperations(value: Set<string>) {
    this.clock = this.loop?.time() ?? this.clock;
    const changed =
      value.size !== this.running.size ||
      [...value].some((x) => !this.running.has(x));
    this.motion.sync(this.scheduler.active, this.running, this.clock);
    this.running = value;
    this.scheduler.syncOperations(value, this.clock);
    this.motion.sync(this.scheduler.active, this.running, this.clock);
    if (changed) this.loop?.wake();
  }
  async init(host: HTMLElement) {
    await this.app.init({
      width: 960,
      height: 540,
      background: 0x242b2c,
      antialias: true,
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
      autoStart: false,
      powerPreference: "low-power",
    });
    if (!this.alive) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.drawBay();
    const [carTexture, crewTexture] = await Promise.all([
      Assets.load(carUrl),
      Assets.load(crewUrl),
    ]);
    if (!this.alive) return;
    const car = new Sprite(carTexture);
    car.anchor.set(0.5);
    this.car.addChild(car);
    this.car.position.set(480, 292);
    this.root.addChild(this.car);
    const positions = [
      [360, 219],
      [575, 220],
      [363, 367],
      [575, 368],
      [693, 293],
      [274, 183],
      [718, 180],
    ];
    positions.forEach((p, i) => {
      const crew = new Sprite(crewTexture);
      crew.anchor.set(0.5);
      crew.scale.set(0.73);
      crew.position.set(p[0], p[1]);
      crew.tint = i === 5 ? 0x9fbcc5 : i === 6 ? 0xe7a985 : 0xd4ed94;
      this.crew.push(crew);
      this.root.addChild(crew);
    });
    this.root.addChild(this.effects);
    this.board.position.set(206, 111);
    this.root.addChild(this.board);
    const resize = () => {
      if (!this.alive) return;
      const w = host.clientWidth,
        h = host.clientHeight;
      this.app.renderer.resize(w, h);
      const s = Math.max(w / 960, h / 540);
      this.root.scale.set(s);
      this.root.position.set((w - 960 * s) / 2, (h - 540 * s) / 2);
      this.dirty = true;
      this.loop?.wake();
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(host);
    resize();
    this.loop = new SceneLoop(this.frame);
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.visibilityChanged();
  }
  label(
    text: string,
    x: number,
    y: number,
    size: number,
    color: number,
    spacing = 0,
  ) {
    const t = new Text({
      text,
      style: {
        fontFamily: "Arial,sans-serif",
        fontSize: size,
        fontWeight: "bold",
        fill: color,
        letterSpacing: spacing,
      },
    });
    t.position.set(x, y);
    this.root.addChild(t);
  }
  drawBay() {
    const g = new Graphics();
    this.root.addChild(g);
    g.rect(0, 0, 960, 540).fill(0x282f30);
    g.rect(0, 0, 960, 177).fill(0x202728);
    g.rect(0, 169, 960, 9).fill(0x11191b);
    // Recessed garage bays and clean architectural lines.
    for (let x = 42; x < 930; x += 294) {
      g.roundRect(x, 21, 267, 127, 5).fill(0x151e20);
      g.rect(x + 9, 30, 249, 98).fill(0x2b3535);
      for (let y = 37; y < 126; y += 13)
        g.rect(x + 9, y, 249, 2).fill(0x354040);
      g.rect(x + 7, 140, 252, 4).fill(0x9cb871);
      g.rect(x + 18, 10, 226, 3).fill(0x59605a);
    }
    this.label("07", 391, 49, 72, 0x414c46);
    this.label("PIT STOP", 494, 63, 23, 0xa2ac9f, 2);
    this.label("LOCAL MOTOR WORKS", 496, 94, 9, 0x768a7b, 2);
    g.rect(0, 186, 960, 252).fill(0x4d5753);
    g.rect(0, 438, 960, 102).fill(0x343d3b);
    for (let x = 0; x < 960; x += 96)
      g.moveTo(x, 187).lineTo(x, 435).stroke({ color: 0x56605c, width: 1 });
    for (let y = 222; y < 438; y += 54)
      g.moveTo(0, y).lineTo(960, y).stroke({ color: 0x56605c, width: 1 });
    g.roundRect(272, 200, 446, 210, 8).stroke({ color: 0xb6c49e, width: 3 });
    g.rect(287, 207, 416, 195).fill({ color: 0x718068, alpha: 0.12 });
    g.moveTo(472, 211)
      .lineTo(506, 211)
      .moveTo(489, 211)
      .lineTo(489, 224)
      .moveTo(472, 399)
      .lineTo(506, 399)
      .moveTo(489, 388)
      .lineTo(489, 399)
      .stroke({ color: 0xc2cfac, width: 3 });
    this.label("BOX  /  07", 292, 383, 10, 0xb9c5ab, 2);
    g.rect(0, 441, 960, 4).fill(0xc7d294);
    g.rect(0, 450, 960, 2).fill(0x161f20);
    for (let x = -15; x < 960; x += 64)
      g.poly([x, 441, x + 22, 441, x + 35, 452, x + 13, 452]).fill(0x171f20);
    for (let x = 10; x < 960; x += 120)
      g.roundRect(x, 500, 62, 4, 1).fill(0x68736c);
    this.label("P I T   L A N E", 46, 476, 12, 0xa0ada0);
    this.label("→", 868, 460, 50, 0xa4b28c);
    // Tool chests, tires, pressure trolley, telemetry station.
    g.roundRect(70, 225, 74, 88, 5).fill(0x263231);
    g.rect(77, 236, 60, 48).fill(0x697362);
    for (let y = 240; y < 283; y += 14) {
      g.rect(80, y, 54, 2).fill(0x374940);
      g.rect(100, y + 4, 15, 2).fill(0xb7bd9d);
    }
    g.circle(84, 314, 6).fill(0x162021);
    g.circle(129, 314, 6).fill(0x162021);
    for (let y = 347; y < 390; y += 15) {
      g.ellipse(114, y, 28, 12).fill(0x182426);
      g.ellipse(114, y - 4, 27, 10).fill(0x2b393a);
      g.ellipse(114, y - 4, 13, 5).fill(0x182425);
    }
    g.roundRect(189, 95, 135, 60, 5).fill(0x111e23);
    g.roundRect(196, 101, 121, 46, 2).fill(0x1b3030);
    g.rect(250, 156, 9, 18).fill(0x101f24);
    g.roundRect(218, 173, 73, 7, 3).fill(0x13242b);
    g.moveTo(204, 139)
      .lineTo(217, 134)
      .lineTo(227, 140)
      .lineTo(243, 125)
      .lineTo(255, 130)
      .lineTo(269, 123)
      .lineTo(288, 130)
      .lineTo(309, 119)
      .stroke({ color: 0x90b663, width: 2 });
    g.roundRect(786, 239, 58, 53, 5).fill(0x263b37);
    g.roundRect(795, 245, 39, 27, 3).fill(0xa6bba0);
    g.circle(814, 258, 10).fill(0x263b37);
    g.moveTo(814, 258).lineTo(820, 252).stroke({ color: 0xc7ef72, width: 2 });
    g.circle(795, 296, 7).fill(0x142428);
    g.circle(834, 296, 7).fill(0x142428);
    g.moveTo(844, 259)
      .bezierCurveTo(895, 264, 885, 343, 833, 337)
      .stroke({ color: 0x263b37, width: 5 });
    g.roundRect(788, 340, 57, 39, 4).fill(0x957a4f);
    g.rect(799, 334, 35, 6).fill(0x29372f);
    g.rect(810, 350, 13, 18).fill(0x273a31);
    // Bay lights and unbranded pit wall markers.
    for (let x = 23; x < 955; x += 910) {
      g.roundRect(x, 210, 7, 200, 2).fill(0x242f2b);
      for (let y = 220; y < 410; y += 24) g.rect(x, y, 7, 11).fill(0x9fa678);
    }
    this.label("CREW READY", 770, 192, 10, 0xaebc9f, 1);
  }
  update(options: SceneOptions) {
    this.options = options;
    this.dirty = true;
    this.visibilityChanged();
  }
  private visibilityChanged = () => {
    this.loop?.configure({
      paused: this.options.paused,
      hidden: document.hidden,
      fps: this.options.fps,
    });
  };
  event(e: PitStopEvent, presentationTime = this.loop?.time() ?? this.clock) {
    this.clock = presentationTime;
    this.motion.sync(this.scheduler.active, this.running, this.clock);
    this.scheduler.push(e, this.clock);
    this.motion.sync(this.scheduler.active, this.running, this.clock);
    if (e.kind === "session.start" || e.kind === "tool.start") {
      this.carVisible = true;
      this.releasePending = false;
      this.board.text = "STAND BY";
    }
    if (e.kind === "turn.complete") {
      this.carVisible = true;
      this.releasePending = true;
    }
    if (e.kind === "session.end") {
      this.carVisible = false;
      this.releasePending = false;
    }
    this.dirty = true;
    this.loop?.wake();
  }
  reset() {
    this.scheduler.reset();
    this.motion.reset();
    this.runningOperations.clear();
    this.carVisible = false;
    this.releasePending = false;
    this.clock = 0;
    this.dirty = true;
    this.loop?.reset();
  }
  frame = (clock: number, dirty: boolean) => {
    this.clock = clock;
    const before = this.scheduler.active.map((x) => x.event.event_id).join("|");
    this.motion.sync(this.scheduler.active, this.running, this.clock);
    const active = this.scheduler.tick(this.clock);
    this.motion.sync(active, this.running, this.clock);
    if (
      this.releasePending &&
      !active.some((entry) => entry.clip.id === "release")
    ) {
      this.carVisible = false;
      this.releasePending = false;
    }
    const changed = before !== active.map((x) => x.event.event_id).join("|");
    if (dirty || this.dirty || changed || !this.options.reduced) this.render();
    this.dirty = false;
    return {
      animate:
        !this.options.reduced &&
        (active.length > 0 ||
          this.runningOperations.size > 0 ||
          this.motion.hasTail(this.clock)),
      wakeAfter: this.scheduler.nextTransition(this.clock),
    };
  };
  render() {
    const active = this.scheduler.active;
    const reduced = this.options.reduced;
    const t = reduced ? 0 : this.clock / 1000;
    const amount = (id: ClipId, delay = 100) =>
      this.motion.amount([id], this.clock, reduced, delay, 420, 420);
    const has = (id: ClipId) => this.motion.amount([id], this.clock, true) > 0;
    const clip = active.find(
      (entry) => entry.clip.id === "arrive" || entry.clip.id === "release",
    );
    const progress = clip
      ? (this.clock - clip.started) / clip.clip.duration
      : 0;
    const pose = carPose(
      clip?.clip.id as "arrive" | "release" | undefined,
      progress,
      reduced,
    );
    this.car.visible = this.carVisible;
    this.car.position.set(pose.x, pose.y - 4 * amount("shell"));
    this.car.rotation = pose.rotation;
    if (clip?.clip.id === "release") this.board.text = "TURN FINISHED";
    else if (has("warning")) this.board.text = "! TOOL FAILED";
    else if (has("test")) this.board.text = "CHECKING…";
    else if (has("build")) this.board.text = "ASSEMBLING";
    else if (has("inspect")) this.board.text = "TELEMETRY";
    else if (has("edit")) this.board.text = "TIRE SERVICE";
    else if (has("mcp")) this.board.text = "RADIO LINK";
    else if (has("shell")) this.board.text = "JACK ACTIVE";
    else if (has("delegate")) this.board.text = "CREW JOINED";
    else if (this.carVisible && this.board.text !== "TURN FINISHED")
      this.board.text = "STAND BY";
    this.crew.forEach((crew, index) => {
      const pose = crewPose(this.motion, index, this.clock, reduced);
      crew.position.set(pose.x, pose.y);
      crew.rotation = pose.rotation;
      crew.alpha = pose.alpha;
    });
    const fx = this.effects;
    fx.clear();
    const edit = amount("edit", 300),
      test = amount("test", 300);
    const wheels = [
      [386, 262],
      [571, 262],
      [386, 337],
      [571, 337],
    ];
    for (let i = 0; i < wheels.length; i++) {
      const [x, y] = wheels[i];
      const opacity = 1 - (1 - edit) * (1 - test);
      if (opacity <= 0) continue;
      const pressure = reduced ? 0 : Math.sin(t * 2.8 + i * 0.8) * 1.3 * test;
      fx.circle(x, y, 16 + 2 * opacity + pressure).stroke({
        color: test > edit ? 0x8aceda : 0xd3f295,
        width: 2,
        alpha: opacity * 0.75,
      });
      if (edit > 0) {
        const angle = reduced ? 0 : Math.sin(t * 4.5 + i * 0.55) * 0.8;
        const dx = Math.cos(angle) * 11,
          dy = Math.sin(angle) * 11;
        fx.moveTo(x - dx, y - dy)
          .lineTo(x + dx, y + dy)
          .stroke({ color: 0xf3f3cc, width: 3, alpha: edit });
        fx.circle(x, y, 3).fill({ color: 0xf3f3cc, alpha: edit });
      }
      if (test > 0) {
        const angle = reduced ? -0.5 : -0.5 + Math.sin(t * 2 + i) * 0.45;
        fx.moveTo(x, y)
          .lineTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12)
          .stroke({ color: 0xc0edf0, width: 2, alpha: test });
      }
    }
    const build = amount("build", 200);
    if (build > 0) {
      const approach = (1 - build) * 14;
      const adjust = reduced ? 0 : Math.sin(t * 2.6) * 1.2 * build;
      fx.roundRect(635 + approach, 252 + adjust, 9, 90, 2).fill({
        color: 0xdaf39e,
        alpha: build,
      });
      fx.roundRect(647 + approach, 251 - adjust, 7, 92, 2).fill({
        color: 0xeffac8,
        alpha: build,
      });
      for (let i = 0; i < 4; i++) {
        const angle = t * 1.7 + (i * Math.PI) / 2;
        fx.circle(
          650 + Math.cos(angle) * 15,
          293 + Math.sin(angle) * 32,
          2,
        ).fill({ color: 0xe6e9bd, alpha: build * 0.8 });
      }
    }
    const jack = amount("shell");
    if (jack > 0) {
      const offset = (1 - jack) * 12;
      fx.poly([
        648 + offset,
        303,
        676 + offset,
        303,
        687 + offset,
        339,
        679 + offset,
        342,
      ]).fill({ color: 0xc99c58, alpha: jack });
      const lift = reduced ? 0 : Math.sin(t * 2.4) * 3 * jack;
      fx.moveTo(678 + offset, 325)
        .lineTo(700 + offset, 309 + lift)
        .stroke({ color: 0xe0ba77, width: 3, alpha: jack });
    }
    const radio = amount("mcp");
    if (radio > 0)
      for (let i = 0; i < 3; i++) {
        const phase = reduced ? i / 3 : (t * 0.55 + i / 3) % 1;
        // Zero alpha at both wrap endpoints makes each expanding wave seamless.
        const opacity = reduced
          ? 0.7 - i * 0.2
          : Math.sin(phase * Math.PI) ** 2 * 0.7;
        fx.circle(268, 175, 17 + phase * 30).stroke({
          color: 0x90d0d3,
          width: 2,
          alpha: radio * opacity,
        });
      }
    const warning = amount("warning", 0);
    if (warning > 0) {
      const y = (1 - warning) * 7;
      fx.roundRect(714, 234 + y, 54, 40, 7).fill({
        color: 0xe5b46d,
        alpha: warning,
      });
      fx.poly([741, 240 + y, 727, 264 + y, 755, 264 + y]).fill({
        color: 0x29332c,
        alpha: warning,
      });
      fx.rect(739, 246 + y, 4, 10).fill({ color: 0xe5b46d, alpha: warning });
      fx.circle(741, 260 + y, 2).fill({ color: 0xe5b46d, alpha: warning });
    }
    const release = amount("release", 0);
    if (release > 0) {
      fx.circle(724, 310, 9).fill({ color: 0xccf284, alpha: release });
      fx.circle(724, 310, 15 + (reduced ? 0 : Math.sin(t * 3) * 1.5)).stroke({
        color: 0xccf284,
        width: 2,
        alpha: release * 0.4,
      });
    }
    this.root.tint =
      this.options.theme === "ember"
        ? 0xffdcc5
        : this.options.theme === "paper"
          ? 0xf8fff0
          : 0xffffff;
    this.app.render();
  }
  destroy() {
    this.alive = false;
    this.loop?.destroy();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.observer?.disconnect();
    if (this.app.renderer)
      this.app.destroy(true, { children: true, texture: false });
  }
}
