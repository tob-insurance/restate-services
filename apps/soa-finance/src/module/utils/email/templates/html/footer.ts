export function createFooter(footerBase64: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; }
      .img-footer {
        margin-bottom: -20px;
      }
    </style>
  </head>
  <body>
    <div class="footer">
      <img class="img-footer" src="${footerBase64}" alt="Logo" style="width: 100%; height: auto;">
    </div>
  </body>
</html>`;
}
