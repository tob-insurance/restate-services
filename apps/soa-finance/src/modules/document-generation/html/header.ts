export function createHeader(headerBase64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    .img-header {
      margin-top: -25px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="img-header" src="${headerBase64}" alt="Logo" style="width: 100%; height: auto;">
  </div>
</body>
</html>`;
}
