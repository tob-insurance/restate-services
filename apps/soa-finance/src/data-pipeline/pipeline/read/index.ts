import { streamFromOracle } from "./oracle-stream-reader";

// export function streamSoaData(asAtDate: Date, accountName: string) {
export function streamSoaData(asAtDate: Date) {
  return streamFromOracle({
    procedureName: "PACKAGE_RPT_FI_SOA.get_rpt_fi_soa_new",
    binds: {
      p_office: "ALL", // office code
      p_class: "ALL",
      p_dc_account_code: "ALL", //"00002733" customer code
      p_dc_account_name: null, // hasil query dari acting code (DID dan AGS)
      p_as_at_date: asAtDate, // tanggal saat ini
      p_userid: "adm", // user id
    },
  });
}
