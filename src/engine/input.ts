// Keyboard/mouse state. Uses physical key codes (event.code) so the layout works on Swiss QWERTZ keyboards too;
// all bindings avoid the Y/Z keys that swap between layouts.

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = [false, false, false];
  mousePressed = [false, false, false];
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'KeyF') {
        if (this.locked) e.preventDefault();
      }
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown = [false, false, false]; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouseDown = [false, false, false];
      this.onLockChange(this.locked);
    });
  }

  lock() {
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required; retried on next click */ });
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }

  /** Call once at the end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.mousePressed = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
