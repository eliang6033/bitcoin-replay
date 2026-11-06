const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

test("student links produce square, downloadable room codes with clear borders", () => {
  const marks = [];
  const context = { fillRect(...bounds) { marks.push([this.fillStyle, ...bounds]); } };
  const canvas = {
    setAttribute() {},
    getContext: () => context,
    toDataURL: () => "data:image/png;base64,example",
  };
  const link = { click() { this.clicked = true; }, remove() {} };
  const document = {
    createElement: tag => tag === "canvas" ? canvas : link,
    body: { append() {} },
  };
  const world = vm.createContext({ URL, document });
  for (const path of ["vendor/qrcode.js", "room-qr.js"]) {
    vm.runInContext(readFileSync(join(__dirname, "../public", path), "utf8"), world);
  }
  const api = world.BitcoinRoomQR;
  for (const url of [
    "https://example.org/bitcoin-replay/?room=0123456789abcdef01234567",
    "http://192.168.1.10:5188/",
  ]) {
    marks.length = 0;
    assert.equal(api.create(url), canvas);
    assert.equal(canvas.width, canvas.height);
    assert.ok(canvas.width >= 900);
    assert.deepEqual(marks[0], ["#ffffff", 0, 0, canvas.width, canvas.height]);
    const [, x, y, width, height] = marks[1];
    assert.deepEqual([x, y], [width * 4, height * 4]);
    assert.ok(marks.slice(1).every(([color, x, y, w, h]) =>
      color === "#000000" && w === width && h === height &&
      x >= 4 * w && y >= 4 * h && x + w <= canvas.width - 4 * w && y + h <= canvas.height - 4 * h));
  }
  assert.throws(() => api.create("https://example.org/?host=123"), /student/i);
  assert.equal(api.downloadLink(canvas), link);
  assert.equal(link.download, "bitcoin-replay-room.png");
  assert.equal(link.href, canvas.toDataURL());
  assert.equal(link.textContent, "Download QR code");
});
