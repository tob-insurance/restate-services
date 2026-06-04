export function createHeader(logoBase64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; padding: 8px 20px 0; }
    .header-table {
      width: 88%;
      border-collapse: collapse;
      margin-left: auto;
      margin-right: auto;
    }
    .company-info {
      text-align: left;
      vertical-align: top;
      padding: 0 0 0 10px;
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #333;
      line-height: 1.4;
    }
    .company-name {
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 2px;
    }
    .logo-cell {
      width: 150px;
      vertical-align: top;
      text-align: right;
      padding: 0 20px 0 0;
    }
    .logo-img {
      height: 72px;
      width: auto;
    }
    .divider-cell {
      padding-top: 6px;
    }
    .divider-rule {
      height: 6px;
      text-align: center;
      line-height: 0;
      background: linear-gradient(
        to bottom,
        transparent 0,
        transparent 2px,
        #595959 2px,
        #595959 3px,
        transparent 3px,
        transparent 6px
      );
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .divider-bar {
      display: inline-block;
      width: 28%;
      height: 6px;
      border-radius: 3px;
      background: #ed7d31;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td class="company-info">
        <div class="company-name">PT Asuransi Total Bersama</div>
        <div>Citra Tower, 27th Floor, Jl. Benyamin Suaeb Blok A6 RT.13/RW06</div>
        <div>Kb. Kosong Kec. Kemayoran - Jakarta Pusat 10630, Indonesia - Telp. (021) 39717273</div>
        <div>www.tob-ins.com | Instagram @tob.ins</div>
      </td>
      <td class="logo-cell">
        <img class="logo-img" src="${logoBase64}" alt="Logo">
      </td>
    </tr>
    <tr>
      <td class="divider-cell" colspan="2">
        <div class="divider-rule"><span class="divider-bar"></span></div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
