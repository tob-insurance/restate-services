export function createFooter(footerBase64: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
        background-image: url("${footerBase64}");
        background-size: 100% auto;
        background-position: bottom center;
        background-repeat: no-repeat;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        padding: 0;
      }
    </style>
  </head>
  <body></body>
</html>`;
}
