import { streamFromOracle } from "./oracle-stream-reader";

export function streamSoaData(asAtDate: Date) {
  return streamFromOracle({
    procedureName: "PACKAGE_RPT_FI_SOA.get_rpt_fi_soa_new",
    binds: {
      p_office: "ALL",
      p_class: "ALL",
      p_dc_account_code: "ALL",
      p_dc_account_name: null,
      p_as_at_date: asAtDate,
      p_userid: "adm",
    },
  });
}
