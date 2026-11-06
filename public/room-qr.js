(() => {
  "use strict";

  function create(joinUrl) {
    const link = new URL(joinUrl);
    if (!["https:", "http:"].includes(link.protocol) || link.searchParams.has("host")) {
      throw new Error("Choose the student invitation link.");
    }
    const qr = qrcode(0, "M");
    qr.addData(link.href, "Byte");
    qr.make();

    const count = qr.getModuleCount();
    const margin = 4; // Clear modules around all four sides make the border detectable.
    const scale = Math.ceil(900 / (count + margin * 2));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = (count + margin * 2) * scale;
    canvas.className = "room-qr";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Scan to join this Bitcoin Replay room");

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  function downloadLink(canvas) {
    const file = document.createElement("a");
    file.download = "bitcoin-replay-room.png";
    file.href = canvas.toDataURL("image/png");
    file.textContent = "Download QR code";
    return file;
  }

  globalThis.BitcoinRoomQR = { create, downloadLink };
})();
