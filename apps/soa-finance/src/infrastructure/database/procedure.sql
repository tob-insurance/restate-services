CREATE OR REPLACE PACKAGE BODY ACPDB.PACKAGE_RPT_FI_SOA AS
/******************************************************************************
   NAME:       PACKAGE_RPT_FI_SOA
   PURPOSE:

   REVISIONS:
   Ver        Date        Author           Description
   ---------  ----------  ---------------  ------------------------------------
   1.0        11/21/2019      Hanggar       1. Created this package body.
******************************************************************************/
    PROCEDURE get_rpt_fi_soa
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_cursor FOR
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,
            plat_no_1||plat_no_2||plat_no_3 plat_no, co_in_fac_ref_no,fire_conjunction_pol,            
            lob,sob,dc_account_full_name,insured_name,distribution_name,distribution_name2,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            end_reason,acting_code,tsi,sum(GP) GP,sum(DISC) DISC,sum(COMM) COMM,sum(PPN) PPN,
            sum(PPH21) PPH21,SUM(PPH23) PPH23,SUM(COST) COST,sum(STMP) STMP,
            sum(GP+DISC+COMM+PPN+PPH21+PPH23+COST+STMP) NETT_PREMIUM,
            pol_inst_no||'/'||pol_total_inst inst_no,due_date
        FROM
        (
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_name2,dc_account_full_name,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,pol_note_no,
            lob_code,pol_office,end_reason,acting_code,
            co_in_fac_ref_no,fire_conjunction_pol,plat_no_1,plat_no_2,plat_no_3,tsi,
            pol_inst_no,pol_total_inst,due_date,
            NVL(GP,0) GP,NVL(DISC,0) DISC,NVL(COMM,0) COMM,NVL(PPN,0) PPN,
            NVL(PPH21,0) PPH21,NVL(PPH23,0) PPH23,NVL(COST,0) COST,NVL(STMP,0) STMP
        FROM
        (
            SELECT 
                mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
                pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,
                pm.distribution_name,pm.distribution_name2,
                case when pm.distribution_type = 'DI' then dn.dc_account_full_name else '' end dc_account_full_name,
                pid.qq_name,
                pe.end_eff_date,pe.end_exp_date,pm.post_date, TRUNC(p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
                CASE WHEN pnd.pol_note_trn_code IN('DPRM','CPRM','RPRM') THEN 'GP' WHEN pnd.pol_note_trn_code IN('DDSC','CDIS','CDSC','DDS1') THEN 'DISC' 
                WHEN pnd.pol_note_trn_code IN('DCOM','CCOM','MCOM','RCOM','DBKG') THEN 'COMM' 
                WHEN pnd.pol_note_trn_code IN('DVAT') THEN 'PPN' WHEN pnd.pol_note_trn_code IN('DW21') THEN 'PPH21' WHEN pnd.pol_note_trn_code IN('DWTX') THEN 'PPH23' 
                WHEN pnd.pol_note_trn_code IN('COST') THEN 'COST' WHEN pnd.pol_note_trn_code IN('STMP') THEN 'STMP' ELSE '' END trn_code,
                pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office,pe.end_reason,cm.acting_code,
                pm.co_in_fac_ref_no,pm.fire_conjunction_pol,
                pmi.plat_no_1,pmi.plat_no_2,pmi.plat_no_3,prp.tsi,
                pn.pol_inst_no,pn.pol_total_inst,pn.due_date
            FROM
            (
                SELECT 
                    dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                    dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name 
                FROM			
                    DCNOTE dn    
                LEFT JOIN
                (
                    SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                    FROM FINANCIAL_SETTLE FS
                    WHERE 
                        TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                    GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
                ) fst
                ON
                    dn.dc_office = fst.dc_office
                    AND dn.dc_year = fst.dc_year
                    AND dn.dc_month = fst.dc_month
                    AND dn.dc_mode = fst.dc_mode
                    AND dn.dc_seq = fst.dc_seq      
                WHERE
                    dn.dc_mode IN ('01','02','03','04','05')
                    AND dn.pol_office is not null
--                    AND fst.dc_office is null
                    and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
--                    AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
            ) dn    
            JOIN 
                POLICY_NOTE_DETAIL	pnd
            ON
                dn.pol_office =	pnd.pol_office
                AND	dn.pol_subclass	= pnd.pol_subclass
                AND	dn.pol_resv	= pnd.pol_resv
                AND	dn.pol_year	= pnd.pol_year
                AND	dn.pol_month = pnd.pol_month
                AND	dn.pol_seq = pnd.pol_sequence
                AND	dn.pol_end_no =	pnd.pol_end_no
                AND	dn.pol_notes_no = pnd.pol_note_no
            JOIN policy_note pn
            ON
                dn.pol_office =	pn.pol_office
                AND	dn.pol_subclass	= pn.pol_subclass
                AND	dn.pol_resv	= pn.pol_resv
                AND	dn.pol_year	= pn.pol_year
                AND	dn.pol_month = pn.pol_month
                AND	dn.pol_seq = pn.pol_sequence
                AND	dn.pol_end_no =	pn.pol_end_no
                AND	dn.pol_notes_no = pn.pol_note_no
            JOIN	
                POLICY_ENDORSEMENT	pe
            ON
                pe.pol_office =	pnd.pol_office
                AND pe.pol_subclass	= pnd.pol_subclass
                AND pe.pol_resv	= pnd.pol_resv
                AND pe.pol_year	= pnd.pol_year
                AND pe.pol_month = pnd.pol_month
                AND pe.pol_sequence	= pnd.pol_sequence
                AND pe.pol_end_no =	pnd.pol_end_no
            JOIN	
                POLICY_MAIN	pm
            ON
                pm.pol_office =	pe.pol_office
                AND pm.pol_subclass = pe.pol_subclass
                AND	pm.pol_resv	= pe.pol_resv
                AND	pm.pol_year	= pe.pol_year
                AND	pm.pol_month = pe.pol_month
                AND	pm.pol_sequence	= pe.pol_sequence
                AND pm.pol_end_no = pe.pol_end_no
            JOIN policy_insured_detail pid
            ON
                pm.pol_office =	pid.pol_office
                AND pm.pol_subclass = pid.pol_subclass
                AND	pm.pol_resv	= pid.pol_resv
                AND	pm.pol_year	= pid.pol_year
                AND	pm.pol_month = pid.pol_month
                AND	pm.pol_sequence	= pid.pol_sequence
                AND pm.pol_end_no = pid.pol_end_no
            LEFT JOIN policy_risk_profile prp 
            ON
                pm.pol_office =	prp.pol_office
                AND pm.pol_subclass = prp.pol_subclass
                AND	pm.pol_resv	= prp.pol_resv
                AND	pm.pol_year	= prp.pol_year
                AND	pm.pol_month = prp.pol_month
                AND	pm.pol_sequence	= prp.pol_sequence
                AND pm.pol_end_no = prp.pol_end_no
                AND prp.item_no = '001'
                AND prp.no_of_years = '1'
            LEFT JOIN policy_motor_info pmi
            ON
                pm.pol_office =	pmi.pol_office
                AND pm.pol_subclass = pmi.pol_subclass
                AND	pm.pol_resv	= pmi.pol_resv
                AND	pm.pol_year	= pmi.pol_year
                AND	pm.pol_month = pmi.pol_month
                AND	pm.pol_sequence	= pmi.pol_sequence
                AND pm.pol_end_no = pmi.pol_end_no
                AND pmi.item_no = '001'
            JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
            JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
            JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
            JOIN MASTER_CM cm ON pm.distribution_code = cm.cm_code
            LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
            WHERE
                (pm.distribution_code = p_dc_account_code OR 'ALL' = p_dc_account_code)
        )
        PIVOT(
            SUM(pol_note_trn_amount)
            FOR trn_code IN('GP' GP,'DISC' DISC,'COMM' COMM,'PPN' PPN,'PPH21' PPH21,'PPH23' PPH23,'COST' COST,'STMP' STMP)
        )
        WHERE
            post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
            AND (p_office = 'ALL' OR pol_office = p_office)
            AND (p_class = 'ALL' OR lob_code = p_class)            
        )
        GROUP BY
            branch,policy_no,pol_end_no,
            contract_no,
            plat_no_1,plat_no_2,plat_no_3,co_in_fac_ref_no,fire_conjunction_pol,            
            lob,sob,dc_account_full_name,insured_name,distribution_name,distribution_name2,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            end_reason,acting_code,tsi,
            pol_inst_no,pol_total_inst,due_date
        ;

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa;
    
    PROCEDURE get_rpt_fi_soa_new 
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
        p_dc_account_name	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_cursor FOR
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,
            plat_no_1||plat_no_2||plat_no_3 plat_no, co_in_fac_ref_no,fire_conjunction_pol,            
            lob,sob,dc_account_full_name,insured_name,distribution_name,distribution_name2,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            end_reason,acting_code,tsi,sum(GP) GP,sum(DISC) DISC,sum(COMM) COMM,sum(PPN) PPN,
            sum(PPH21) PPH21,SUM(PPH23) PPH23,SUM(COST) COST,sum(STMP) STMP,
            sum(GP+DISC+COMM+PPN+PPH21+PPH23+COST+STMP) NETT_PREMIUM,
            pol_inst_no||'/'||pol_total_inst inst_no,due_date,
            -- added distribution_code in below
             DC_OFFICE || '-' ||DC_MONTH || '-' || DC_MODE|| '-' ||DC_YEAR|| '-' ||DC_SEQ DC_NOTE,orig_amount,distribution_code
        FROM
        (
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_name2,dc_account_full_name,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,pol_note_no,
            lob_code,pol_office,end_reason,acting_code,
            co_in_fac_ref_no,fire_conjunction_pol,plat_no_1,plat_no_2,plat_no_3,tsi,
            pol_inst_no,pol_total_inst,due_date,
            NVL(GP,0) GP,NVL(DISC,0) DISC,NVL(COMM,0) COMM,NVL(PPN,0) PPN,
            NVL(PPH21,0) PPH21,NVL(PPH23,0) PPH23,NVL(COST,0) COST,NVL(STMP,0) STMP,
            -- added distribution_code in below
             DC_SEQ,DC_MODE,DC_MONTH,DC_YEAR,DC_OFFICE,orig_amount,distribution_code
        FROM
        (
            SELECT 
                mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
                pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,
                pm.distribution_name,pm.distribution_name2,
                case when pm.distribution_type = 'DI' then dn.dc_account_full_name else '' end dc_account_full_name,
                pid.qq_name,
                pe.end_eff_date,pe.end_exp_date,pm.post_date, TRUNC(p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
                CASE WHEN pnd.pol_note_trn_code IN('DPRM','CPRM','RPRM') THEN 'GP' WHEN pnd.pol_note_trn_code IN('DDSC','CDIS','CDSC','DDS1') THEN 'DISC' 
                WHEN pnd.pol_note_trn_code IN('DCOM','CCOM','MCOM','RCOM','DBKG') THEN 'COMM' 
                WHEN pnd.pol_note_trn_code IN('DVAT') THEN 'PPN' WHEN pnd.pol_note_trn_code IN('DW21') THEN 'PPH21' WHEN pnd.pol_note_trn_code IN('DWTX') THEN 'PPH23' 
                WHEN pnd.pol_note_trn_code IN('COST') THEN 'COST' WHEN pnd.pol_note_trn_code IN('STMP') THEN 'STMP' ELSE '' END trn_code,
                pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office,pe.end_reason,cm.acting_code,
                pm.co_in_fac_ref_no,pm.fire_conjunction_pol,
                pmi.plat_no_1,pmi.plat_no_2,pmi.plat_no_3,prp.tsi,
                pn.pol_inst_no,pn.pol_total_inst,pn.due_date,
                -- added distribution_code in below
                dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.orig_amount,pm.distribution_code
            FROM
            (
                SELECT 
                    dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                    dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name,dn.orig_amount 
                FROM			
                    DCNOTE dn    
                LEFT JOIN
                (
                    SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                    FROM FINANCIAL_SETTLE FS
                    WHERE 
                        TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                    GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
                ) fst
                ON
                    dn.dc_office = fst.dc_office
                    AND dn.dc_year = fst.dc_year
                    AND dn.dc_month = fst.dc_month
                    AND dn.dc_mode = fst.dc_mode
                    AND dn.dc_seq = fst.dc_seq      
                WHERE
                    dn.dc_mode IN ('01','02','03','04','05')
                    AND dn.pol_office is not null
--                    AND fst.dc_office is null
                    and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
--                    AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
            ) dn    
            JOIN 
                POLICY_NOTE_DETAIL	pnd
            ON
                dn.pol_office =	pnd.pol_office
                AND	dn.pol_subclass	= pnd.pol_subclass
                AND	dn.pol_resv	= pnd.pol_resv
                AND	dn.pol_year	= pnd.pol_year
                AND	dn.pol_month = pnd.pol_month
                AND	dn.pol_seq = pnd.pol_sequence
                AND	dn.pol_end_no =	pnd.pol_end_no
                AND	dn.pol_notes_no = pnd.pol_note_no
            JOIN policy_note pn
            ON
                dn.pol_office =	pn.pol_office
                AND	dn.pol_subclass	= pn.pol_subclass
                AND	dn.pol_resv	= pn.pol_resv
                AND	dn.pol_year	= pn.pol_year
                AND	dn.pol_month = pn.pol_month
                AND	dn.pol_seq = pn.pol_sequence
                AND	dn.pol_end_no =	pn.pol_end_no
                AND	dn.pol_notes_no = pn.pol_note_no
            JOIN	
                POLICY_ENDORSEMENT	pe
            ON
                pe.pol_office =	pnd.pol_office
                AND pe.pol_subclass	= pnd.pol_subclass
                AND pe.pol_resv	= pnd.pol_resv
                AND pe.pol_year	= pnd.pol_year
                AND pe.pol_month = pnd.pol_month
                AND pe.pol_sequence	= pnd.pol_sequence
                AND pe.pol_end_no =	pnd.pol_end_no
            JOIN	
                POLICY_MAIN	pm
            ON
                pm.pol_office =	pe.pol_office
                AND pm.pol_subclass = pe.pol_subclass
                AND	pm.pol_resv	= pe.pol_resv
                AND	pm.pol_year	= pe.pol_year
                AND	pm.pol_month = pe.pol_month
                AND	pm.pol_sequence	= pe.pol_sequence
                AND pm.pol_end_no = pe.pol_end_no
            JOIN policy_insured_detail pid
            ON
                pm.pol_office =	pid.pol_office
                AND pm.pol_subclass = pid.pol_subclass
                AND	pm.pol_resv	= pid.pol_resv
                AND	pm.pol_year	= pid.pol_year
                AND	pm.pol_month = pid.pol_month
                AND	pm.pol_sequence	= pid.pol_sequence
                AND pm.pol_end_no = pid.pol_end_no
            LEFT JOIN policy_risk_profile prp 
            ON
                pm.pol_office =	prp.pol_office
                AND pm.pol_subclass = prp.pol_subclass
                AND	pm.pol_resv	= prp.pol_resv
                AND	pm.pol_year	= prp.pol_year
                AND	pm.pol_month = prp.pol_month
                AND	pm.pol_sequence	= prp.pol_sequence
                AND pm.pol_end_no = prp.pol_end_no
                AND prp.item_no = '001'
                AND prp.no_of_years = '1'
            LEFT JOIN policy_motor_info pmi
            ON
                pm.pol_office =	pmi.pol_office
                AND pm.pol_subclass = pmi.pol_subclass
                AND	pm.pol_resv	= pmi.pol_resv
                AND	pm.pol_year	= pmi.pol_year
                AND	pm.pol_month = pmi.pol_month
                AND	pm.pol_sequence	= pmi.pol_sequence
                AND pm.pol_end_no = pmi.pol_end_no
                AND pmi.item_no = '001'
            JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
            JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
            JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
            JOIN MASTER_CM cm ON pm.distribution_code = cm.cm_code
            LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
            WHERE
                (pm.distribution_code = p_dc_account_code OR 'ALL' = p_dc_account_code or (pm.distribution_name2 = p_dc_account_name and p_dc_account_name is not null))
        )
        PIVOT(
            SUM(pol_note_trn_amount)
            FOR trn_code IN('GP' GP,'DISC' DISC,'COMM' COMM,'PPN' PPN,'PPH21' PPH21,'PPH23' PPH23,'COST' COST,'STMP' STMP)
        )
        WHERE
            post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
            AND (p_office = 'ALL' OR pol_office = p_office)
            AND (p_class = 'ALL' OR lob_code = p_class)            
        )
        GROUP BY
            branch,policy_no,pol_end_no,
            contract_no,
            plat_no_1,plat_no_2,plat_no_3,co_in_fac_ref_no,fire_conjunction_pol,            
            lob,sob,dc_account_full_name,insured_name,distribution_name,distribution_name2,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            end_reason,acting_code,tsi,
            pol_inst_no,pol_total_inst,due_date, 
             DC_SEQ,DC_MODE,DC_MONTH,DC_YEAR,DC_OFFICE,orig_amount,distribution_code
        ;

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa_new;

    PROCEDURE get_rpt_fi_soa_new_optimized
    (
        p_office          IN  VARCHAR2,
        p_class           IN  VARCHAR2,
        p_dc_account_code IN  VARCHAR2,
        p_dc_account_name IN  VARCHAR2,
        p_as_at_date      IN  DATE,
        p_userid          IN  VARCHAR2,
        p_cursor          OUT Types.ref_cursor,
        p_status          OUT VARCHAR2,
        p_error_message   OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_cursor FOR
            WITH
                -- Pre-filter offices for user (reduces join scope)
                user_offices AS (
                    SELECT /*+ MATERIALIZE */ office_code
                    FROM MASTER_STAFF_BRANCH
                    WHERE staff_code = p_userid
                ),
                -- Pre-aggregate FINANCIAL_SETTLE (MUCH faster than LEFT JOIN in main query)
                financial_settle_agg AS (
                    SELECT /*+ MATERIALIZE */
                        DC_OFFICE, DC_YEAR, DC_MONTH, DC_MODE, DC_SEQ,
                        SUM(FN_ORIG_AMT) AS settled_amt
                    FROM FINANCIAL_SETTLE
                    WHERE POST_DATE <= p_as_at_date  -- Use index!
                    GROUP BY DC_OFFICE, DC_YEAR, DC_MONTH, DC_MODE, DC_SEQ
                ),
                -- Get unsettled or partially settled DCNOTE records
                filtered_dcnote AS (
                    SELECT /*+ LEADING(dn) USE_HASH(fst) */
                        dn.pol_subclass, dn.pol_resv, dn.pol_office, dn.pol_month,
                        dn.pol_year, dn.pol_seq, dn.pol_end_no, dn.pol_notes_no,
                        dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq,
                        dn.currency, dn.dc_account_full_name, dn.orig_amount
                    FROM DCNOTE dn
                             LEFT JOIN financial_settle_agg fst
                                       ON dn.dc_office = fst.dc_office
                                           AND dn.dc_year = fst.dc_year
                                           AND dn.dc_month = fst.dc_month
                                           AND dn.dc_mode = fst.dc_mode
                                           AND dn.dc_seq = fst.dc_seq
                    WHERE dn.dc_mode IN ('01','02','03','04','05')
                      AND dn.pol_office IS NOT NULL
                      AND ABS(dn.orig_amount) - ABS(NVL(fst.settled_amt, 0)) > 1  -- Outstanding balance > 1
                ),
                -- Main query with all joins
                base_data AS (
                    SELECT /*+ LEADING(dn pm) USE_HASH(pnd pe pid) */
                        mb.description AS branch,
                        dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq AS policy_no,
                        dn.pol_end_no AS pol_end_no,
                        pm.alt_polno AS contract_no,
                        rl.lob_desc AS lob,
                        rl.lob_code,
                        pm.source_of_business AS sob,
                        pm.distribution_type AS tob,
                        pm.insured_name,
                        pm.distribution_name,
                        pm.distribution_name2,
                        CASE WHEN pm.distribution_type = 'DI' THEN dn.dc_account_full_name ELSE '' END AS dc_account_full_name,
                        pid.qq_name,
                        pe.end_eff_date,
                        pe.end_exp_date,
                        pm.post_date,
                        TRUNC(p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END AS aging,
                        dn.currency AS curr,
                        NVL(exc.the_rate, 1) AS exch_rate,
                        pe.end_reason,
                        cm.acting_code,
                        pm.co_in_fac_ref_no,
                        pm.fire_conjunction_pol,
                        pmi.plat_no_1,
                        pmi.plat_no_2,
                        pmi.plat_no_3,
                        prp.tsi,
                        pn.pol_inst_no,
                        pn.pol_total_inst,
                        pn.due_date,
                        dn.dc_office,
                        dn.dc_year,
                        dn.dc_month,
                        dn.dc_mode,
                        dn.dc_seq,
                        dn.orig_amount,
                        -- Pivot columns inline (faster than PIVOT operator)
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('DPRM','CPRM','RPRM') THEN pnd.pol_note_trn_amount ELSE 0 END) AS GP,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('DDSC','CDIS','CDSC','DDS1') THEN pnd.pol_note_trn_amount ELSE 0 END) AS DISC,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('DCOM','CCOM','MCOM','RCOM','DBKG') THEN pnd.pol_note_trn_amount ELSE 0 END) AS COMM,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('DVAT') THEN pnd.pol_note_trn_amount ELSE 0 END) AS PPN,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('DW21') THEN pnd.pol_note_trn_amount ELSE 0 END) AS PPH21,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('DWTX') THEN pnd.pol_note_trn_amount ELSE 0 END) AS PPH23,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('COST') THEN pnd.pol_note_trn_amount ELSE 0 END) AS COST,
                        SUM(CASE WHEN pnd.pol_note_trn_code IN ('STMP') THEN pnd.pol_note_trn_amount ELSE 0 END) AS STMP
                    FROM filtered_dcnote dn
                             JOIN POLICY_MAIN pm
                                  ON pm.pol_office = dn.pol_office
                                      AND pm.pol_subclass = dn.pol_subclass
                                      AND pm.pol_resv = dn.pol_resv
                                      AND pm.pol_year = dn.pol_year
                                      AND pm.pol_month = dn.pol_month
                                      AND pm.pol_sequence = dn.pol_seq
                                      AND pm.pol_end_no = dn.pol_end_no
                                      -- Push filter EARLY!
                                      AND (pm.distribution_code = p_dc_account_code OR 'ALL' = p_dc_account_code
                                          OR (pm.distribution_name2 = p_dc_account_name AND p_dc_account_name IS NOT NULL))
                             JOIN user_offices uo ON pm.pol_office = uo.office_code  -- Early filter
                             JOIN POLICY_NOTE_DETAIL pnd
                                  ON dn.pol_office = pnd.pol_office
                                      AND dn.pol_subclass = pnd.pol_subclass
                                      AND dn.pol_resv = pnd.pol_resv
                                      AND dn.pol_year = pnd.pol_year
                                      AND dn.pol_month = pnd.pol_month
                                      AND dn.pol_seq = pnd.pol_sequence
                                      AND dn.pol_end_no = pnd.pol_end_no
                                      AND dn.pol_notes_no = pnd.pol_note_no
                             JOIN POLICY_ENDORSEMENT pe
                                  ON pe.pol_office = pnd.pol_office
                                      AND pe.pol_subclass = pnd.pol_subclass
                                      AND pe.pol_resv = pnd.pol_resv
                                      AND pe.pol_year = pnd.pol_year
                                      AND pe.pol_month = pnd.pol_month
                                      AND pe.pol_sequence = pnd.pol_sequence
                                      AND pe.pol_end_no = pnd.pol_end_no
                                      AND pm.post_date <= p_as_at_date  -- Filter early!
                             JOIN POLICY_NOTE pn
                                  ON dn.pol_office = pn.pol_office
                                      AND dn.pol_subclass = pn.pol_subclass
                                      AND dn.pol_resv = pn.pol_resv
                                      AND dn.pol_year = pn.pol_year
                                      AND dn.pol_month = pn.pol_month
                                      AND dn.pol_seq = pn.pol_sequence
                                      AND dn.pol_end_no = pn.pol_end_no
                                      AND dn.pol_notes_no = pn.pol_note_no
                             JOIN POLICY_INSURED_DETAIL pid
                                  ON pm.pol_office = pid.pol_office
                                      AND pm.pol_subclass = pid.pol_subclass
                                      AND pm.pol_resv = pid.pol_resv
                                      AND pm.pol_year = pid.pol_year
                                      AND pm.pol_month = pid.pol_month
                                      AND pm.pol_sequence = pid.pol_sequence
                                      AND pm.pol_end_no = pid.pol_end_no
                             JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
                             JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office
                             JOIN MASTER_CM cm ON pm.distribution_code = cm.cm_code
                             LEFT JOIN POLICY_RISK_PROFILE prp
                                       ON pm.pol_office = prp.pol_office
                                           AND pm.pol_subclass = prp.pol_subclass
                                           AND pm.pol_resv = prp.pol_resv
                                           AND pm.pol_year = prp.pol_year
                                           AND pm.pol_month = prp.pol_month
                                           AND pm.pol_sequence = prp.pol_sequence
                                           AND pm.pol_end_no = prp.pol_end_no
                                           AND prp.item_no = '001'
                                           AND prp.no_of_years = '1'
                             LEFT JOIN POLICY_MOTOR_INFO pmi
                                       ON pm.pol_office = pmi.pol_office
                                           AND pm.pol_subclass = pmi.pol_subclass
                                           AND pm.pol_resv = pmi.pol_resv
                                           AND pm.pol_year = pmi.pol_year
                                           AND pm.pol_month = pmi.pol_month
                                           AND pm.pol_sequence = pmi.pol_sequence
                                           AND pm.pol_end_no = pmi.pol_end_no
                                           AND pmi.item_no = '001'
                             LEFT JOIN EXCH_RATE exc
                                       ON dn.currency = exc.cur_code
                                           AND TO_CHAR(exc.as_at, 'YYYYMM') = pe.Acct_Year || pe.Acct_Month
                    WHERE (p_office = 'ALL' OR pm.pol_office = p_office)
                      AND (p_class = 'ALL' OR rl.lob_code = p_class)
                    GROUP BY
                        mb.description, dn.pol_subclass, dn.pol_office, dn.pol_month, dn.pol_year, dn.pol_seq,
                        dn.pol_end_no, pm.alt_polno, rl.lob_desc, rl.lob_code, pm.source_of_business,
                        pm.distribution_type, pm.insured_name, pm.distribution_name, pm.distribution_name2,
                        dn.dc_account_full_name, pid.qq_name, pe.end_eff_date, pe.end_exp_date, pm.post_date,
                        pe.end_post_date, pe.pol_end_no, dn.currency, exc.the_rate, pe.end_reason, cm.acting_code,
                        pm.co_in_fac_ref_no, pm.fire_conjunction_pol, pmi.plat_no_1, pmi.plat_no_2, pmi.plat_no_3,
                        prp.tsi, pn.pol_inst_no, pn.pol_total_inst, pn.due_date,
                        dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq, dn.orig_amount
                )
            SELECT
                branch, policy_no, pol_end_no, contract_no,
                plat_no_1||plat_no_2||plat_no_3 AS plat_no,
                co_in_fac_ref_no, fire_conjunction_pol,
                lob, sob, dc_account_full_name, insured_name,
                distribution_name, distribution_name2, qq_name,
                end_eff_date, end_exp_date, post_date, aging,
                curr, exch_rate, end_reason, acting_code, tsi,
                GP, DISC, COMM, PPN, PPH21, PPH23, COST, STMP,
                GP + DISC + COMM + PPN + PPH21 + PPH23 + COST + STMP AS NETT_PREMIUM,
                pol_inst_no||'/'||pol_total_inst AS inst_no,
                due_date,
                DC_OFFICE || '-' || DC_MONTH || '-' || DC_MODE || '-' || DC_YEAR || '-' || DC_SEQ AS DC_NOTE,
                orig_amount
            FROM base_data;
    
        p_status := '1';
        p_error_message := 'ok';
    
    EXCEPTION
        WHEN OTHERS THEN
            p_status := '0';
            p_error_message := SUBSTR(SQLERRM, 1, 100);
    END get_rpt_fi_soa_new_optimized;
    
    PROCEDURE get_rpt_fi_soa_non_ls
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_cursor FOR
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            lob_code,pol_office,sum(GP) GP,sum(DISC) DISC,sum(COMM) COMM,sum(PPN) PPN,
            sum(PPH21) PPH21,SUM(PPH23) PPH23,SUM(COST) COST,sum(STMP) STMP,
            sum(GP+DISC+COMM+PPN+PPH21+PPH23+COST+STMP) NETT_PREMIUM
        FROM
        (
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,dc_account_full_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,pol_note_no,
            lob_code,pol_office,NVL(GP,0) GP,NVL(DISC,0) DISC,NVL(COMM,0) COMM,NVL(PPN,0) PPN,
            NVL(PPH21,0) PPH21,NVL(PPH23,0) PPH23,NVL(COST,0) COST,NVL(STMP,0) STMP
        FROM
        (
            SELECT 
                mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
                pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,pm.distribution_name,pm.distribution_code,dn.dc_account_full_name,
                pe.end_eff_date,pe.end_exp_date,pm.post_date, TRUNC(SYSDATE) - TRUNC(pe.end_eff_date) aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
                CASE WHEN pnd.pol_note_trn_code IN('DPRM') THEN 'GP' WHEN pnd.pol_note_trn_code IN('DDSC','CDIS','CDSC','DDS1') THEN 'DISC' 
                WHEN pnd.pol_note_trn_code IN('DCOM','MCOM','RCOM','DBKG') THEN 'COMM' 
                WHEN pnd.pol_note_trn_code IN('DVAT') THEN 'PPN' WHEN pnd.pol_note_trn_code IN('DW21') THEN 'PPH21' WHEN pnd.pol_note_trn_code IN('DWTX') THEN 'PPH23' 
                WHEN pnd.pol_note_trn_code IN('COST') THEN 'COST' WHEN pnd.pol_note_trn_code IN('STMP') THEN 'STMP' ELSE '' END trn_code,
                pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office
            FROM
            (
                SELECT 
                    dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                    dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name 
                FROM			
                    DCNOTE dn    
                LEFT JOIN
                (
                    SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                    FROM FINANCIAL_SETTLE FS
                    WHERE 
                        TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                    GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
                ) fst
                ON
                    dn.dc_office = fst.dc_office
                    AND dn.dc_year = fst.dc_year
                    AND dn.dc_month = fst.dc_month
                    AND dn.dc_mode = fst.dc_mode
                    AND dn.dc_seq = fst.dc_seq      
                WHERE
                    dn.dc_mode IN ('01','02','03','04','05')
                    AND dn.pol_office is not null
                    --AND fst.dc_office is null
                    and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
                    AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
            ) dn    
            JOIN 
                POLICY_NOTE_DETAIL	pnd
            ON
                dn.pol_office =	pnd.pol_office
                AND	dn.pol_subclass	= pnd.pol_subclass
                AND	dn.pol_resv	= pnd.pol_resv
                AND	dn.pol_year	= pnd.pol_year
                AND	dn.pol_month = pnd.pol_month
                AND	dn.pol_seq = pnd.pol_sequence
                AND	dn.pol_end_no =	pnd.pol_end_no
                AND	dn.pol_notes_no = pnd.pol_note_no
            JOIN	
                POLICY_ENDORSEMENT	pe
            ON
                pe.pol_office =	pnd.pol_office
                AND pe.pol_subclass	= pnd.pol_subclass
                AND pe.pol_resv	= pnd.pol_resv
                AND pe.pol_year	= pnd.pol_year
                AND pe.pol_month = pnd.pol_month
                AND pe.pol_sequence	= pnd.pol_sequence
                AND pe.pol_end_no =	pnd.pol_end_no
            JOIN	
                POLICY_MAIN	pm
            ON
                pm.pol_office =	pe.pol_office
                AND pm.pol_subclass = pe.pol_subclass
                AND	pm.pol_resv	= pe.pol_resv
                AND	pm.pol_year	= pe.pol_year
                AND	pm.pol_month = pe.pol_month
                AND	pm.pol_sequence	= pe.pol_sequence
                AND pm.pol_end_no = pe.pol_end_no
            JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
            JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
            JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
            LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
            WHERE 
                pm.distribution_type <>'LS' AND pm.distribution_code <> '00002120'
        )
        PIVOT(
            SUM(pol_note_trn_amount)
            FOR trn_code IN('GP' GP,'DISC' DISC,'COMM' COMM,'PPN' PPN,'PPH21' PPH21,'PPH23' PPH23,'COST' COST,'STMP' STMP)
        )
        WHERE
            post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
            AND (p_office = 'ALL' OR pol_office = p_office)
            AND (p_class = 'ALL' OR lob_code = p_class)
        )
        GROUP BY
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            lob_code,pol_office
        ;

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa_non_ls;
    
    PROCEDURE get_rpt_fi_soa_autolaps_old
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_cursor FOR
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            lob_code,pol_office,autolaps,sum(GP) GP,sum(DISC) DISC,sum(COMM) COMM,sum(PPN) PPN,
            sum(PPH21) PPH21,SUM(PPH23) PPH23,SUM(COST) COST,sum(STMP) STMP,
            sum(GP+DISC+COMM+PPN+PPH21+PPH23+COST+STMP) NETT_PREMIUM
        FROM
        (
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,dc_account_full_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,pol_note_no,
            lob_code,pol_office,autolaps,NVL(GP,0) GP,NVL(DISC,0) DISC,NVL(COMM,0) COMM,NVL(PPN,0) PPN,
            NVL(PPH21,0) PPH21,NVL(PPH23,0) PPH23,NVL(COST,0) COST,NVL(STMP,0) STMP
        FROM
        (
            SELECT 
                mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
                pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,pm.distribution_name,pm.distribution_code,dn.dc_account_full_name,
                pe.end_eff_date,pe.end_exp_date,pm.post_date, TRUNC(SYSDATE) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
                CASE WHEN pnd.pol_note_trn_code IN('DPRM','CPRM') THEN 'GP' WHEN pnd.pol_note_trn_code IN('DDSC','CDIS','CDSC','DDS1') THEN 'DISC' 
                WHEN pnd.pol_note_trn_code IN('CCOM','DCOM','MCOM','RCOM','DBKG') THEN 'COMM' 
                WHEN pnd.pol_note_trn_code IN('DVAT') THEN 'PPN' WHEN pnd.pol_note_trn_code IN('DW21') THEN 'PPH21' WHEN pnd.pol_note_trn_code IN('DWTX') THEN 'PPH23' 
                WHEN pnd.pol_note_trn_code IN('COST') THEN 'COST' WHEN pnd.pol_note_trn_code IN('STMP') THEN 'STMP' ELSE '' END trn_code,
                pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office,sob.autolaps
            FROM
            (
                SELECT 
                    dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                    dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name 
                FROM			
                    DCNOTE dn    
                LEFT JOIN
                (
                    SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                    FROM FINANCIAL_SETTLE FS
                    WHERE 
                        TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                    GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
                ) fst
                ON
                    dn.dc_office = fst.dc_office
                    AND dn.dc_year = fst.dc_year
                    AND dn.dc_month = fst.dc_month
                    AND dn.dc_mode = fst.dc_mode
                    AND dn.dc_seq = fst.dc_seq      
                WHERE
                    dn.dc_mode IN ('01','02','03','04','05')
                    AND dn.pol_office is not null
                    --AND fst.dc_office is null
                    and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
                    AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
            ) dn    
            JOIN 
                POLICY_NOTE_DETAIL	pnd
            ON
                dn.pol_office =	pnd.pol_office
                AND	dn.pol_subclass	= pnd.pol_subclass
                AND	dn.pol_resv	= pnd.pol_resv
                AND	dn.pol_year	= pnd.pol_year
                AND	dn.pol_month = pnd.pol_month
                AND	dn.pol_seq = pnd.pol_sequence
                AND	dn.pol_end_no =	pnd.pol_end_no
                AND	dn.pol_notes_no = pnd.pol_note_no
            JOIN	
                POLICY_ENDORSEMENT	pe
            ON
                pe.pol_office =	pnd.pol_office
                AND pe.pol_subclass	= pnd.pol_subclass
                AND pe.pol_resv	= pnd.pol_resv
                AND pe.pol_year	= pnd.pol_year
                AND pe.pol_month = pnd.pol_month
                AND pe.pol_sequence	= pnd.pol_sequence
                AND pe.pol_end_no =	pnd.pol_end_no
            JOIN	
                POLICY_MAIN	pm
            ON
                pm.pol_office =	pe.pol_office
                AND pm.pol_subclass = pe.pol_subclass
                AND	pm.pol_resv	= pe.pol_resv
                AND	pm.pol_year	= pe.pol_year
                AND	pm.pol_month = pe.pol_month
                AND	pm.pol_sequence	= pe.pol_sequence
                AND pm.pol_end_no = pe.pol_end_no
            JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
            JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
            JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
            JOIN MASTER_AGING_SOB sob ON sob.cm_code = pm.distribution_code
            LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
            WHERE 
                pm.distribution_type IN('DI','AG') AND pm.distribution_code <> '00002120'
                AND rl.lob_code IN('MT','FR','EN','GA','LI','BO','MI')
                AND pm.source_of_business = 'DIR'
                AND pm.facultative = 'N'
                AND trunc(pe.end_eff_date) >= to_date('01-JUN-2020')
        )
        PIVOT(
            SUM(pol_note_trn_amount)
            FOR trn_code IN('GP' GP,'DISC' DISC,'COMM' COMM,'PPN' PPN,'PPH21' PPH21,'PPH23' PPH23,'COST' COST,'STMP' STMP)
        )
        WHERE
            post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
            AND (p_office = 'ALL' OR pol_office = p_office)
            AND (p_class = 'ALL' OR lob_code = p_class)
            AND aging > autolaps
        )
        GROUP BY
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            lob_code,pol_office,autolaps
        ;

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa_autolaps_old;
    
    PROCEDURE get_rpt_fi_soa_autolaps
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    
    CURSOR c_data is
    SELECT 
        branch,policy_no,pol_end_no,
        contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
        end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
        lob_code,pol_office,autolaps,pol_subclass,pol_month,pol_year,pol_sequence,autolaps_policy
    FROM
    (
        SELECT 
            mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
            pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,pm.distribution_name,pm.distribution_code,dn.dc_account_full_name,
            pe.end_eff_date,pe.end_exp_date,trunc(pm.post_date) post_date, TRUNC(p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
            pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office,sob.autolaps,
            pm.pol_subclass,pm.pol_month,pm.pol_year,pm.pol_sequence,pm.autolaps autolaps_policy
        FROM
        (
            SELECT 
                dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name 
            FROM			
                DCNOTE dn    
            LEFT JOIN
            (
                SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                FROM FINANCIAL_SETTLE FS
                WHERE 
                    TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
            ) fst
            ON
                dn.dc_office = fst.dc_office
                AND dn.dc_year = fst.dc_year
                AND dn.dc_month = fst.dc_month
                AND dn.dc_mode = fst.dc_mode
                AND dn.dc_seq = fst.dc_seq      
            WHERE
                dn.dc_mode IN ('01','02','03','04','05')
                AND dn.pol_office is not null
                --AND dn.pol_end_no = '000'
                and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
                AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
                AND dn.total_inst_no = 1
        ) dn    
        JOIN 
            POLICY_NOTE_DETAIL	pnd
        ON
            dn.pol_office =	pnd.pol_office
            AND	dn.pol_subclass	= pnd.pol_subclass
            AND	dn.pol_resv	= pnd.pol_resv
            AND	dn.pol_year	= pnd.pol_year
            AND	dn.pol_month = pnd.pol_month
            AND	dn.pol_seq = pnd.pol_sequence
            AND	dn.pol_end_no =	pnd.pol_end_no
            AND	dn.pol_notes_no = pnd.pol_note_no
            AND pnd.pol_note_trn_code = 'DPRM'
        JOIN	
            POLICY_ENDORSEMENT	pe
        ON
            pe.pol_office =	pnd.pol_office
            AND pe.pol_subclass	= pnd.pol_subclass
            AND pe.pol_resv	= pnd.pol_resv
            AND pe.pol_year	= pnd.pol_year
            AND pe.pol_month = pnd.pol_month
            AND pe.pol_sequence	= pnd.pol_sequence
            AND pe.pol_end_no =	pnd.pol_end_no
        JOIN	
            POLICY_MAIN	pm
        ON
            pm.pol_office =	pe.pol_office
            AND pm.pol_subclass = pe.pol_subclass
            AND	pm.pol_resv	= pe.pol_resv
            AND	pm.pol_year	= pe.pol_year
            AND	pm.pol_month = pe.pol_month
            AND	pm.pol_sequence	= pe.pol_sequence
            AND pm.pol_end_no = pe.pol_end_no
        JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
        JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
        JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
        JOIN MASTER_AGING_SOB sob ON sob.cm_code = pm.distribution_code
        LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
        WHERE 
            pm.distribution_type IN('DI','AG','BR') AND pm.distribution_code <> '00002120'
            AND rl.lob_code IN('MT','FR','EN','GA','LI','MI')
            AND pm.source_of_business = 'DIR'
            AND NVL(pm.facultative,'N') = 'N'
            AND NVL(pm.is_facility,'N') = 'N'
            AND trunc(pe.end_eff_date) >= to_date('01-JUN-2020')
            AND pm.pol_end_no='000'
    )        
    WHERE
        post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
        AND (p_office = 'ALL' OR pol_office = p_office)
        AND (p_class = 'ALL' OR lob_code = p_class)
        AND aging > autolaps        
    GROUP BY
        branch,policy_no,pol_end_no,
        contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
        end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
        lob_code,pol_office,autolaps,pol_subclass,pol_month,pol_year,pol_sequence,autolaps_policy
    ORDER BY 
        branch,policy_no,pol_end_no
    ;
    
    cursor c_exist_cnp
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    SELECT count(*) as tot FROM policy_main 
    WHERE 
        pol_status = 'CANP'
        AND pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        ;
        
    cursor c_exist_fac
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select count(*) 
    from policy_ri_arrangement pra
    join ri_master_contract ri 
    on
        pra.contract_office = ri.contract_office 
        AND pra.contract_class = ri.contract_class 
        AND pra.contract_type = ri.contract_type 
        AND pra.contract_year = ri.contract_year
        AND pra.contract_month = ri.contract_month 
        AND pra.contract_seq = ri.contract_seq
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND ri.ri_type_code in('FAC','FOB') 
        ;  
        
    cursor c_exist_coins
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select count(*) 
    from policy_coinsurer
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence 
        ;
        
    cursor c_get_gp
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DPRM','CPRM') 
        ;       
    
    cursor c_get_disc
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DDSC','CDIS','CDSC','DDS1') 
        ;
    
    cursor c_get_comm
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('CCOM','DCOM','MCOM','RCOM','DBKG') 
        ;
        
    cursor c_get_ppn
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DVAT') 
        ;
    
    cursor c_get_pph21
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DW21') 
        ;
        
    cursor c_get_pph23
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DWTX') 
        ;
        
    cursor c_get_cost
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('COST') 
        ;
        
    cursor c_get_stmp
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('STMP') 
        ;
        
        
    n_count_cnp int;
    n_count_fac int;
    n_count_coins int;
    n_gp            number(38,10);
    n_disc            number(38,10);
    n_comm          number(38,10);
    n_ppn           number(38,10);
    n_pph21         number(38,10);
    n_pph23         number(38,10);
    n_cost          number(38,10);
    n_stmp          number(38,10);
    n_nett          number(38,10);
    
    
    BEGIN
        delete from report_fi_soa where user_id=p_userid;
    
        for rec in c_data
        loop
            /* cek cancel  */
            OPEN	c_exist_cnp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_exist_cnp
            INTO	n_count_cnp;
            IF 	c_exist_cnp%NOTFOUND THEN
                n_count_cnp := 0;
            END IF;
            CLOSE	c_exist_cnp;
            
            if n_count_cnp > 0 then
                continue;
            end if;
            
            /* cek fac  */
            OPEN	c_exist_fac(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_exist_fac
            INTO	n_count_fac;
            IF 	c_exist_fac%NOTFOUND THEN
                n_count_fac := 0;
            END IF;
            CLOSE	c_exist_fac;
            
            if n_count_fac > 0 then
                continue;
            end if;
            
            /* cek coins  */
            OPEN	c_exist_coins(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_exist_coins
            INTO	n_count_coins;
            IF 	c_exist_coins%NOTFOUND THEN
                n_count_coins := 0;
            END IF;
            CLOSE	c_exist_coins;
            
            if n_count_coins > 0 then
                continue;
            end if;
            
            OPEN	c_get_gp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_gp
            INTO	n_gp;
            IF 	c_get_gp%NOTFOUND THEN
                n_gp := 0;
            END IF;
            CLOSE	c_get_gp;
            
            OPEN	c_get_disc(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_disc
            INTO	n_disc;
            IF 	c_get_disc%NOTFOUND THEN
                n_disc := 0;
            END IF;
            CLOSE	c_get_disc;
            
            OPEN	c_get_comm(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_comm
            INTO	n_comm;
            IF 	c_get_comm%NOTFOUND THEN
                n_comm := 0;
            END IF;
            CLOSE	c_get_comm;
            
            OPEN	c_get_ppn(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_ppn
            INTO	n_ppn;
            IF 	c_get_ppn%NOTFOUND THEN
                n_ppn := 0;
            END IF;
            CLOSE	c_get_ppn;
            
            OPEN	c_get_pph21(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_pph21
            INTO	n_pph21;
            IF 	c_get_pph21%NOTFOUND THEN
                n_pph21 := 0;
            END IF;
            CLOSE	c_get_pph21;
            
            OPEN	c_get_pph23(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_pph23
            INTO	n_pph23;
            IF 	c_get_pph23%NOTFOUND THEN
                n_pph23 := 0;
            END IF;
            CLOSE	c_get_pph23;
            
            OPEN	c_get_cost(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_cost
            INTO	n_cost;
            IF 	c_get_cost%NOTFOUND THEN
                n_cost := 0;
            END IF;
            CLOSE	c_get_cost;
            
            OPEN	c_get_stmp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_stmp
            INTO	n_stmp;
            IF 	c_get_stmp%NOTFOUND THEN
                n_stmp := 0;
            END IF;
            CLOSE	c_get_stmp;
            
            n_nett := n_gp+n_disc+n_comm+n_ppn+n_pph21+n_pph23+n_cost+n_stmp;
    
				
            insert into report_fi_soa
            (
                branch,
                policy_no,
                pol_end_no,
                contract_no,
                lob,
                sob,
                tob,
                insured_name,
                distribution_name,
                distribution_code,
                end_eff_date,
                end_exp_date,
                post_date,
                aging,
                curr,
                exch_rate,
                lob_code,
                pol_office,
                autolaps,
                gp,
                disc,
                comm,
                ppn,
                pph21,
                pph23,
                cost,
                stmp,
                user_id
            )
            values
            (
                rec.branch,
                rec.policy_no,
                rec.pol_end_no,
                rec.contract_no,
                rec.lob,
                rec.sob,
                rec.tob,
                rec.insured_name,
                rec.distribution_name,
                rec.distribution_code,
                rec.end_eff_date,
                rec.end_exp_date,
                rec.post_date,
                rec.aging,
                rec.curr,
                rec.exch_rate,
                rec.lob_code,
                rec.pol_office,
                NVL(rec.autolaps_policy,rec.autolaps),
                n_gp,
                n_disc,
                n_comm,
                n_ppn,
                n_pph21,
                n_pph23,
                n_cost,
                n_stmp,
                p_userid
            );
        end loop;
        
        OPEN P_CURSOR FOR
        SELECT * 
        FROM report_fi_soa
        where
            user_id = p_userid
        ; 

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa_autolaps;
    
    PROCEDURE get_rpt_fi_soa_scheduler
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    
    CURSOR c_data is
    SELECT 
        branch,policy_no,pol_end_no,
        contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
        end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
        lob_code,pol_office,autolaps,pol_subclass,pol_month,pol_year,pol_sequence,autolaps_policy
    FROM
    (
        SELECT 
            mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
            pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,pm.distribution_name,pm.distribution_code,dn.dc_account_full_name,
            pe.end_eff_date,pe.end_exp_date,trunc(pm.post_date) post_date, TRUNC(p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
            pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office,sob.autolaps,
            pm.pol_subclass,pm.pol_month,pm.pol_year,pm.pol_sequence,pm.autolaps autolaps_policy
        FROM
        (
            SELECT 
                dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name 
            FROM			
                DCNOTE dn    
            LEFT JOIN
            (
                SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                FROM FINANCIAL_SETTLE FS
                WHERE 
                    TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
            ) fst
            ON
                dn.dc_office = fst.dc_office
                AND dn.dc_year = fst.dc_year
                AND dn.dc_month = fst.dc_month
                AND dn.dc_mode = fst.dc_mode
                AND dn.dc_seq = fst.dc_seq      
            WHERE
                dn.dc_mode IN ('01','02','03','04','05')
                AND dn.pol_office is not null
                --AND dn.pol_end_no = '000'
                and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
                AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
                AND dn.total_inst_no = 1
        ) dn    
        JOIN 
            POLICY_NOTE_DETAIL	pnd
        ON
            dn.pol_office =	pnd.pol_office
            AND	dn.pol_subclass	= pnd.pol_subclass
            AND	dn.pol_resv	= pnd.pol_resv
            AND	dn.pol_year	= pnd.pol_year
            AND	dn.pol_month = pnd.pol_month
            AND	dn.pol_seq = pnd.pol_sequence
            AND	dn.pol_end_no =	pnd.pol_end_no
            AND	dn.pol_notes_no = pnd.pol_note_no
            AND pnd.pol_note_trn_code = 'DPRM'
        JOIN	
            POLICY_ENDORSEMENT	pe
        ON
            pe.pol_office =	pnd.pol_office
            AND pe.pol_subclass	= pnd.pol_subclass
            AND pe.pol_resv	= pnd.pol_resv
            AND pe.pol_year	= pnd.pol_year
            AND pe.pol_month = pnd.pol_month
            AND pe.pol_sequence	= pnd.pol_sequence
            AND pe.pol_end_no =	pnd.pol_end_no
        JOIN	
            POLICY_MAIN	pm
        ON
            pm.pol_office =	pe.pol_office
            AND pm.pol_subclass = pe.pol_subclass
            AND	pm.pol_resv	= pe.pol_resv
            AND	pm.pol_year	= pe.pol_year
            AND	pm.pol_month = pe.pol_month
            AND	pm.pol_sequence	= pe.pol_sequence
            AND pm.pol_end_no = pe.pol_end_no
        JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
        JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
        JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
        JOIN MASTER_AGING_SOB sob ON sob.cm_code = pm.distribution_code
        LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
        WHERE 
            pm.distribution_type IN('DI','AG','BR') AND pm.distribution_code <> '00002120'
            AND rl.lob_code IN('MT','FR','EN','GA','LI','MI')
            AND pm.source_of_business = 'DIR'
            AND pm.facultative = 'N'
            AND trunc(pe.end_eff_date) >= to_date('01-JUN-2020')
            AND pm.pol_end_no='000'
    )        
    WHERE
        post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
        AND (p_office = 'ALL' OR pol_office = p_office)
        AND (p_class = 'ALL' OR lob_code = p_class)
--        AND aging > autolaps
    GROUP BY
        branch,policy_no,pol_end_no,
        contract_no,lob,sob,tob,insured_name,distribution_name,distribution_code,
        end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
        lob_code,pol_office,autolaps,pol_subclass,pol_month,pol_year,pol_sequence,autolaps_policy
    ORDER BY 
        branch,policy_no,pol_end_no
    ;
    
    cursor c_exist_cnp
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    SELECT count(*) as tot FROM policy_main 
    WHERE 
        pol_status = 'CANP'
        AND pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        ;
        
    cursor c_exist_fac
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select count(*) 
    from policy_ri_arrangement pra
    join ri_master_contract ri 
    on
        pra.contract_office = ri.contract_office 
        AND pra.contract_class = ri.contract_class 
        AND pra.contract_type = ri.contract_type 
        AND pra.contract_year = ri.contract_year
        AND pra.contract_month = ri.contract_month 
        AND pra.contract_seq = ri.contract_seq
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND ri.ri_type_code in('FAC','FOB') 
        ;  
        
    cursor c_exist_coins
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select count(*) 
    from policy_coinsurer
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence 
        ;
        
    cursor c_get_gp
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DPRM','CPRM') 
        ;       
    
    cursor c_get_disc
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DDSC','CDIS','CDSC','DDS1') 
        ;
    
    cursor c_get_comm
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('CCOM','DCOM','MCOM','RCOM','DBKG') 
        ;
        
    cursor c_get_ppn
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DVAT') 
        ;
    
    cursor c_get_pph21
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DW21') 
        ;
        
    cursor c_get_pph23
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('DWTX') 
        ;
        
    cursor c_get_cost
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('COST') 
        ;
        
    cursor c_get_stmp
    (
        p_pol_office varchar2, 
        p_pol_subclass varchar2, 
        p_pol_year varchar2, 
        p_pol_month varchar2, 
        p_pol_sequence varchar2
    )
    is
    select sum(pol_note_trn_amount) 
    from policy_note_detail
    WHERE 
        pol_subclass = p_pol_subclass
        AND pol_office = p_pol_office
        AND pol_month = p_pol_month
        AND pol_year = p_pol_year
        AND pol_sequence = p_pol_sequence
        AND pol_note_trn_code in('STMP') 
        ;
        
        
    n_count_cnp int;
    n_count_fac int;
    n_count_coins int;
    n_gp            number(38,10);
    n_disc            number(38,10);
    n_comm          number(38,10);
    n_ppn           number(38,10);
    n_pph21         number(38,10);
    n_pph23         number(38,10);
    n_cost          number(38,10);
    n_stmp          number(38,10);
    n_nett          number(38,10);
    
    
    BEGIN
        delete from report_fi_soa where user_id=p_userid;
    
        for rec in c_data
        loop
            /* cek cancel  */
            OPEN	c_exist_cnp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_exist_cnp
            INTO	n_count_cnp;
            IF 	c_exist_cnp%NOTFOUND THEN
                n_count_cnp := 0;
            END IF;
            CLOSE	c_exist_cnp;
            
            if n_count_cnp > 0 then
                continue;
            end if;
            
            /* cek fac  */
            OPEN	c_exist_fac(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_exist_fac
            INTO	n_count_fac;
            IF 	c_exist_fac%NOTFOUND THEN
                n_count_fac := 0;
            END IF;
            CLOSE	c_exist_fac;
            
            if n_count_fac > 0 then
                continue;
            end if;
            
            /* cek coins  */
            OPEN	c_exist_coins(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_exist_coins
            INTO	n_count_coins;
            IF 	c_exist_coins%NOTFOUND THEN
                n_count_coins := 0;
            END IF;
            CLOSE	c_exist_coins;
            
            if n_count_coins > 0 then
                continue;
            end if;
            
            OPEN	c_get_gp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_gp
            INTO	n_gp;
            IF 	c_get_gp%NOTFOUND THEN
                n_gp := 0;
            END IF;
            CLOSE	c_get_gp;
            
            OPEN	c_get_disc(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_disc
            INTO	n_disc;
            IF 	c_get_disc%NOTFOUND THEN
                n_disc := 0;
            END IF;
            CLOSE	c_get_disc;
            
            OPEN	c_get_comm(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_comm
            INTO	n_comm;
            IF 	c_get_comm%NOTFOUND THEN
                n_comm := 0;
            END IF;
            CLOSE	c_get_comm;
            
            OPEN	c_get_ppn(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_ppn
            INTO	n_ppn;
            IF 	c_get_ppn%NOTFOUND THEN
                n_ppn := 0;
            END IF;
            CLOSE	c_get_ppn;
            
            OPEN	c_get_pph21(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_pph21
            INTO	n_pph21;
            IF 	c_get_pph21%NOTFOUND THEN
                n_pph21 := 0;
            END IF;
            CLOSE	c_get_pph21;
            
            OPEN	c_get_pph23(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_pph23
            INTO	n_pph23;
            IF 	c_get_pph23%NOTFOUND THEN
                n_pph23 := 0;
            END IF;
            CLOSE	c_get_pph23;
            
            OPEN	c_get_cost(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_cost
            INTO	n_cost;
            IF 	c_get_cost%NOTFOUND THEN
                n_cost := 0;
            END IF;
            CLOSE	c_get_cost;
            
            OPEN	c_get_stmp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
            FETCH	c_get_stmp
            INTO	n_stmp;
            IF 	c_get_stmp%NOTFOUND THEN
                n_stmp := 0;
            END IF;
            CLOSE	c_get_stmp;
            
            n_nett := n_gp+n_disc+n_comm+n_ppn+n_pph21+n_pph23+n_cost+n_stmp;
    
				
            insert into report_fi_soa
            (
                branch,
                policy_no,
                pol_end_no,
                contract_no,
                lob,
                sob,
                tob,
                insured_name,
                distribution_name,
                distribution_code,
                end_eff_date,
                end_exp_date,
                post_date,
                aging,
                curr,
                exch_rate,
                lob_code,
                pol_office,
                autolaps,
                gp,
                disc,
                comm,
                ppn,
                pph21,
                pph23,
                cost,
                stmp,
                user_id
            )
            values
            (
                rec.branch,
                rec.policy_no,
                rec.pol_end_no,
                rec.contract_no,
                rec.lob,
                rec.sob,
                rec.tob,
                rec.insured_name,
                rec.distribution_name,
                rec.distribution_code,
                rec.end_eff_date,
                rec.end_exp_date,
                rec.post_date,
                rec.aging,
                rec.curr,
                rec.exch_rate,
                rec.lob_code,
                rec.pol_office,
                NVL(rec.autolaps_policy,rec.autolaps),
                n_gp,
                n_disc,
                n_comm,
                n_ppn,
                n_pph21,
                n_pph23,
                n_cost,
                n_stmp,
                p_userid
            );
        end loop; 
        
        OPEN P_CURSOR FOR
        SELECT * 
        FROM report_fi_soa
        where
            user_id = p_userid
        ; 

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa_scheduler;
    
    PROCEDURE get_rpt_lapse_by_confirm_date (
        p_confirm_date  IN DATE,
        p_userid        IN VARCHAR2,
        p_cursor        OUT types.ref_cursor,
        p_status        OUT VARCHAR2,
        p_error_message OUT VARCHAR2
    ) IS

        CURSOR c_data IS
        SELECT
            mb.description        branch,
            pm.pol_subclass
            || '-'
            || pm.pol_office
            || '-'
            || pm.pol_month
            || '-'
            || pm.pol_year
            || '-'
            || pm.pol_sequence    policy_no,
            pm.pol_end_no,
            pm.alt_polno          contract_no,
            rl.lob_desc           lob,
            pm.source_of_business sob,
            pm.distribution_type  tob,
            pm.insured_name,
            pm.distribution_name,
            pm.distribution_code,
            pm.eff_date,
            pm.exp_date,
            pm.post_date,
            ''                    aging,
            'IDR'                 curr,
            1                     exch_rate,
            rl.lob_code,
            pm.pol_office,
            ''                    autolaps,
            pm.pol_subclass,
            pm.pol_month,
            pm.pol_year,
            pm.pol_sequence,
            ''                    autolaps_policy
        FROM
                 (
                SELECT
                    *
                FROM
                         lapse_confirmation lc
                    JOIN lapse_policy lp ON lc.lapse_no = lp.lapse_no
                WHERE
                        trunc(lc.confirm_date) = p_confirm_date
                    AND trunc(lp.cancelled_date) = p_confirm_date
            ) lapse
            JOIN policy_main    pm ON lapse.pol_office = pm.pol_office
                                   AND lapse.pol_subclass = pm.pol_subclass
                                   AND lapse.pol_resv = pm.pol_resv
                                   AND lapse.pol_month = pm.pol_month
                                   AND lapse.pol_year = pm.pol_year
                                   AND lapse.pol_sequence = pm.pol_sequence
                                   AND pm.pol_end_no = '000'
            JOIN master_branch  mb ON mb.office_code = lapse.pol_office
            JOIN master_rbc_lob rl ON pm.pol_subclass = rl.subclass_code;

        CURSOR c_exist_cnp (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            COUNT(*) AS tot
        FROM
            policy_main
        WHERE
                pol_status = 'CANP'
            AND pol_subclass = p_pol_subclass
            AND pol_office = p_pol_office
            AND pol_month = p_pol_month
            AND pol_year = p_pol_year
            AND pol_sequence = p_pol_sequence;

        CURSOR c_exist_fac (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            COUNT(*)
        FROM
                 policy_ri_arrangement pra
            JOIN ri_master_contract ri ON pra.contract_office = ri.contract_office
                                          AND pra.contract_class = ri.contract_class
                                          AND pra.contract_type = ri.contract_type
                                          AND pra.contract_year = ri.contract_year
                                          AND pra.contract_month = ri.contract_month
                                          AND pra.contract_seq = ri.contract_seq
        WHERE
                pol_subclass = p_pol_subclass
            AND pol_office = p_pol_office
            AND pol_month = p_pol_month
            AND pol_year = p_pol_year
            AND pol_sequence = p_pol_sequence
            AND ri.ri_type_code IN ( 'FAC', 'FOB' );

        CURSOR c_exist_coins (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            COUNT(*)
        FROM
            policy_coinsurer
        WHERE
                pol_subclass = p_pol_subclass
            AND pol_office = p_pol_office
            AND pol_month = p_pol_month
            AND pol_year = p_pol_year
            AND pol_sequence = p_pol_sequence;

        CURSOR c_get_gp (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'DPRM', 'CPRM' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_disc (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'DDSC', 'CDIS', 'CDSC', 'DDS1' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_comm (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'CCOM', 'DCOM', 'MCOM', 'RCOM', 'DBKG' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_ppn (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'DVAT' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_pph21 (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'DW21' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_pph23 (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'DWTX' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_cost (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'COST' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        CURSOR c_get_stmp (
            p_pol_office   VARCHAR2,
            p_pol_subclass VARCHAR2,
            p_pol_year     VARCHAR2,
            p_pol_month    VARCHAR2,
            p_pol_sequence VARCHAR2
        ) IS
        SELECT
            SUM(pol_note_trn_amount)
        FROM
                 policy_note_detail a
            JOIN policy_endorsement b ON a.pol_office = b.pol_office
                                         AND a.pol_subclass = b.pol_subclass
                                         AND a.pol_resv = b.pol_resv
                                         AND a.pol_year = b.pol_year
                                         AND a.pol_month = b.pol_month
                                         AND a.pol_sequence = b.pol_sequence
                                         AND a.pol_end_no = b.pol_end_no
        WHERE
                a.pol_subclass = p_pol_subclass
            AND a.pol_office = p_pol_office
            AND a.pol_month = p_pol_month
            AND a.pol_year = p_pol_year
            AND a.pol_sequence = p_pol_sequence
            AND a.pol_note_trn_code IN ( 'STMP' )
            AND b.end_type NOT IN ( 'CNP', 'CNC' );

        n_count_cnp   INT;
        n_count_fac   INT;
        n_count_coins INT;
        n_gp          NUMBER(38, 10);
        n_disc        NUMBER(38, 10);
        n_comm        NUMBER(38, 10);
        n_ppn         NUMBER(38, 10);
        n_pph21       NUMBER(38, 10);
        n_pph23       NUMBER(38, 10);
        n_cost        NUMBER(38, 10);
        n_stmp        NUMBER(38, 10);
        n_nett        NUMBER(38, 10);
    BEGIN
        DELETE FROM report_fi_soa
        WHERE
            user_id = p_userid;

        FOR rec IN c_data LOOP            
            /* cek cancel  */
--            OPEN	c_exist_cnp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);
--            FETCH	c_exist_cnp
--            INTO	n_count_cnp;
--            IF 	c_exist_cnp%NOTFOUND THEN
--                n_count_cnp := 0;
--            END IF;
--            CLOSE	c_exist_cnp;
--            
--            if n_count_cnp > 0 then
--                continue;
--            end if;
            
            /* cek fac  */
            OPEN c_exist_fac(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_exist_fac INTO n_count_fac;
            IF c_exist_fac%notfound THEN
                n_count_fac := 0;
            END IF;
            CLOSE c_exist_fac;
            IF n_count_fac > 0 THEN
                CONTINUE;
            END IF;
            
            /* cek coins  */
            OPEN c_exist_coins(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_exist_coins INTO n_count_coins;
            IF c_exist_coins%notfound THEN
                n_count_coins := 0;
            END IF;
            CLOSE c_exist_coins;
            IF n_count_coins > 0 THEN
                CONTINUE;
            END IF;
            OPEN c_get_gp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_gp INTO n_gp;
            IF c_get_gp%notfound THEN
                n_gp := 0;
            END IF;
            CLOSE c_get_gp;
            OPEN c_get_disc(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_disc INTO n_disc;
            IF c_get_disc%notfound THEN
                n_disc := 0;
            END IF;
            CLOSE c_get_disc;
            OPEN c_get_comm(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_comm INTO n_comm;
            IF c_get_comm%notfound THEN
                n_comm := 0;
            END IF;
            CLOSE c_get_comm;
            OPEN c_get_ppn(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_ppn INTO n_ppn;
            IF c_get_ppn%notfound THEN
                n_ppn := 0;
            END IF;
            CLOSE c_get_ppn;
            OPEN c_get_pph21(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_pph21 INTO n_pph21;
            IF c_get_pph21%notfound THEN
                n_pph21 := 0;
            END IF;
            CLOSE c_get_pph21;
            OPEN c_get_pph23(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_pph23 INTO n_pph23;
            IF c_get_pph23%notfound THEN
                n_pph23 := 0;
            END IF;
            CLOSE c_get_pph23;
            OPEN c_get_cost(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_cost INTO n_cost;
            IF c_get_cost%notfound THEN
                n_cost := 0;
            END IF;
            CLOSE c_get_cost;
            OPEN c_get_stmp(rec.pol_office, rec.pol_subclass, rec.pol_year, rec.pol_month, rec.pol_sequence);

            FETCH c_get_stmp INTO n_stmp;
            IF c_get_stmp%notfound THEN
                n_stmp := 0;
            END IF;
            CLOSE c_get_stmp;
            n_nett := nvl(n_gp,0) + nvl(n_disc,0) + nvl(n_comm,0) + nvl(n_ppn,0) + nvl(n_pph21,0) + nvl(n_pph23,0) + nvl(n_cost,0) + nvl(n_stmp,0);

            INSERT INTO report_fi_soa (
                branch,
                policy_no,
                pol_end_no,
                contract_no,
                lob,
                sob,
                tob,
                insured_name,
                distribution_name,
                distribution_code,
                end_eff_date,
                end_exp_date,
                post_date,
                aging,
                curr,
                exch_rate,
                lob_code,
                pol_office,
                autolaps,
                gp,
                disc,
                comm,
                ppn,
                pph21,
                pph23,
                cost,
                stmp,
                nett_premium,
                user_id
            ) VALUES (
                rec.branch,
                rec.policy_no,
                rec.pol_end_no,
                rec.contract_no,
                rec.lob,
                rec.sob,
                rec.tob,
                rec.insured_name,
                rec.distribution_name,
                rec.distribution_code,
                rec.eff_date,
                rec.exp_date,
                rec.post_date,
                rec.aging,
                rec.curr,
                rec.exch_rate,
                rec.lob_code,
                rec.pol_office,
                nvl(rec.autolaps_policy, rec.autolaps),
                n_gp,
                n_disc,
                n_comm,
                n_ppn,
                n_pph21,
                n_pph23,
                n_cost,
                n_stmp,
                n_nett,
                p_userid
            );

        END LOOP;

        OPEN p_cursor FOR SELECT
                             *
                         FROM
                             report_fi_soa
                         WHERE
                             user_id = p_userid;

        p_status := '1';
        p_error_message := 'ok';
    EXCEPTION
        WHEN OTHERS THEN
            p_status := '0';
            p_error_message := substr(sqlerrm, 1, 100);
    END get_rpt_lapse_by_confirm_date;  
    
    PROCEDURE get_rpt_fi_soa_ahass
	(
		p_office         	IN  VARCHAR2,
		p_class          	IN  VARCHAR2,
		p_dc_account_code	IN  VARCHAR2,
		p_as_at_date    	IN  DATE,		
		--
		p_userid         	IN  VARCHAR2,
		p_cursor            OUT Types.ref_cursor,
		p_status         	OUT VARCHAR2,
		p_error_message  	OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_cursor FOR
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,SUBSTR( contract_no, INSTR( contract_no, '-', 1 ) + 1, 5 ) ahass_code,
            plat_no_1||plat_no_2||plat_no_3 plat_no, co_in_fac_ref_no,fire_conjunction_pol,            
            lob,sob,dc_account_full_name,insured_name,distribution_name,distribution_name2,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            end_reason,acting_code,tsi,sum(GP) GP,sum(DISC) DISC,sum(COMM) COMM,sum(PPN) PPN,
            sum(PPH21) PPH21,SUM(PPH23) PPH23,SUM(COST) COST,sum(STMP) STMP,
            sum(GP+DISC+COMM+PPN+PPH21+PPH23+COST+STMP) NETT_PREMIUM,
            pol_inst_no||'/'||pol_total_inst inst_no,due_date
        FROM
        (
        SELECT 
            branch,policy_no,pol_end_no,
            contract_no,lob,sob,tob,insured_name,distribution_name,distribution_name2,dc_account_full_name,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,pol_note_no,
            lob_code,pol_office,end_reason,acting_code,
            co_in_fac_ref_no,fire_conjunction_pol,plat_no_1,plat_no_2,plat_no_3,tsi,
            pol_inst_no,pol_total_inst,due_date,
            NVL(GP,0) GP,NVL(DISC,0) DISC,NVL(COMM,0) COMM,NVL(PPN,0) PPN,
            NVL(PPH21,0) PPH21,NVL(PPH23,0) PPH23,NVL(COST,0) COST,NVL(STMP,0) STMP
        FROM
        (
            SELECT 
                mb.description branch,dn.pol_subclass||'-'||dn.pol_office||'-'||dn.pol_month||'-'||dn.pol_year||'-'||dn.pol_seq policy_no,dn.pol_end_no pol_end_no,
                pm.alt_polno contract_no,rl.lob_desc lob,pm.source_of_business sob,pm.distribution_type tob,pm.insured_name,
                pm.distribution_name,pm.distribution_name2,
                case when pm.distribution_type = 'DI' then dn.dc_account_full_name else '' end dc_account_full_name,
                pid.qq_name,
                pe.end_eff_date,pe.end_exp_date,pm.post_date, TRUNC(p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,dn.currency curr,nvl(exc.the_rate,1) exch_rate,pnd.pol_note_no,
                CASE WHEN pnd.pol_note_trn_code IN('DPRM','CPRM','RPRM') THEN 'GP' WHEN pnd.pol_note_trn_code IN('DDSC','CDIS','CDSC','DDS1') THEN 'DISC' 
                WHEN pnd.pol_note_trn_code IN('DCOM','CCOM','MCOM','RCOM','DBKG') THEN 'COMM' 
                WHEN pnd.pol_note_trn_code IN('DVAT') THEN 'PPN' WHEN pnd.pol_note_trn_code IN('DW21') THEN 'PPH21' WHEN pnd.pol_note_trn_code IN('DWTX') THEN 'PPH23' 
                WHEN pnd.pol_note_trn_code IN('COST') THEN 'COST' WHEN pnd.pol_note_trn_code IN('STMP') THEN 'STMP' ELSE '' END trn_code,
                pnd.pol_note_trn_amount,rl.lob_code,pm.pol_office,pe.end_reason,cm.acting_code,
                pm.co_in_fac_ref_no,pm.fire_conjunction_pol,
                pmi.plat_no_1,pmi.plat_no_2,pmi.plat_no_3,prp.tsi,
                pn.pol_inst_no,pn.pol_total_inst,pn.due_date
            FROM
            (
                SELECT 
                    dn.pol_subclass,dn.pol_resv,dn.pol_office,dn.pol_month,dn.pol_year,dn.pol_seq,dn.pol_end_no,dn.pol_notes_no,
                    dn.dc_office,dn.dc_year,dn.dc_month,dn.dc_mode,dn.dc_seq,dn.currency,dn.dc_account_full_name 
                FROM			
                    DCNOTE dn    
                LEFT JOIN
                (
                    SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ, SUM(FS.FN_ORIG_AMT) AMT  
                    FROM FINANCIAL_SETTLE FS
                    WHERE 
                        TO_CHAR(POST_DATE,'yyyymmdd') <= TO_CHAR(p_as_at_date ,'yyyymmdd')
                    GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ 
                ) fst
                ON
                    dn.dc_office = fst.dc_office
                    AND dn.dc_year = fst.dc_year
                    AND dn.dc_month = fst.dc_month
                    AND dn.dc_mode = fst.dc_mode
                    AND dn.dc_seq = fst.dc_seq      
                WHERE
                    dn.dc_mode IN ('01','02','03','04','05')
                    AND dn.pol_office is not null
--                    AND fst.dc_office is null
                    and (abs(dn.orig_amount) - abs(nvl(fst.amt,0))) > 1
--                    AND (dn.dc_account_code = p_dc_account_code OR 'ALL' = p_dc_account_code) 
            ) dn    
            JOIN 
                POLICY_NOTE_DETAIL	pnd
            ON
                dn.pol_office =	pnd.pol_office
                AND	dn.pol_subclass	= pnd.pol_subclass
                AND	dn.pol_resv	= pnd.pol_resv
                AND	dn.pol_year	= pnd.pol_year
                AND	dn.pol_month = pnd.pol_month
                AND	dn.pol_seq = pnd.pol_sequence
                AND	dn.pol_end_no =	pnd.pol_end_no
                AND	dn.pol_notes_no = pnd.pol_note_no
            JOIN policy_note pn
            ON
                dn.pol_office =	pn.pol_office
                AND	dn.pol_subclass	= pn.pol_subclass
                AND	dn.pol_resv	= pn.pol_resv
                AND	dn.pol_year	= pn.pol_year
                AND	dn.pol_month = pn.pol_month
                AND	dn.pol_seq = pn.pol_sequence
                AND	dn.pol_end_no =	pn.pol_end_no
                AND	dn.pol_notes_no = pn.pol_note_no
            JOIN	
                POLICY_ENDORSEMENT	pe
            ON
                pe.pol_office =	pnd.pol_office
                AND pe.pol_subclass	= pnd.pol_subclass
                AND pe.pol_resv	= pnd.pol_resv
                AND pe.pol_year	= pnd.pol_year
                AND pe.pol_month = pnd.pol_month
                AND pe.pol_sequence	= pnd.pol_sequence
                AND pe.pol_end_no =	pnd.pol_end_no
            JOIN	
                POLICY_MAIN	pm
            ON
                pm.pol_office =	pe.pol_office
                AND pm.pol_subclass = pe.pol_subclass
                AND	pm.pol_resv	= pe.pol_resv
                AND	pm.pol_year	= pe.pol_year
                AND	pm.pol_month = pe.pol_month
                AND	pm.pol_sequence	= pe.pol_sequence
                AND pm.pol_end_no = pe.pol_end_no
            JOIN policy_insured_detail pid
            ON
                pm.pol_office =	pid.pol_office
                AND pm.pol_subclass = pid.pol_subclass
                AND	pm.pol_resv	= pid.pol_resv
                AND	pm.pol_year	= pid.pol_year
                AND	pm.pol_month = pid.pol_month
                AND	pm.pol_sequence	= pid.pol_sequence
                AND pm.pol_end_no = pid.pol_end_no
            LEFT JOIN policy_risk_profile prp 
            ON
                pm.pol_office =	prp.pol_office
                AND pm.pol_subclass = prp.pol_subclass
                AND	pm.pol_resv	= prp.pol_resv
                AND	pm.pol_year	= prp.pol_year
                AND	pm.pol_month = prp.pol_month
                AND	pm.pol_sequence	= prp.pol_sequence
                AND pm.pol_end_no = prp.pol_end_no
                AND prp.item_no = '001'
                AND prp.no_of_years = '1'
            LEFT JOIN policy_motor_info pmi
            ON
                pm.pol_office =	pmi.pol_office
                AND pm.pol_subclass = pmi.pol_subclass
                AND	pm.pol_resv	= pmi.pol_resv
                AND	pm.pol_year	= pmi.pol_year
                AND	pm.pol_month = pmi.pol_month
                AND	pm.pol_sequence	= pmi.pol_sequence
                AND pm.pol_end_no = pmi.pol_end_no
                AND pmi.item_no = '001'
            JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
            JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office	  
            JOIN MASTER_STAFF_BRANCH msb ON msb.office_code = pm.pol_office AND msb.staff_code = p_userid
            JOIN MASTER_CM cm ON pm.distribution_code = cm.cm_code
            LEFT JOIN exch_rate exc ON dn.currency = exc.cur_code AND to_char(exc.as_at,'yyyyMM') = pe.Acct_Year||pe.Acct_Month
            WHERE
                (pm.distribution_code = p_dc_account_code OR 'ALL' = p_dc_account_code)
        )
        PIVOT(
            SUM(pol_note_trn_amount)
            FOR trn_code IN('GP' GP,'DISC' DISC,'COMM' COMM,'PPN' PPN,'PPH21' PPH21,'PPH23' PPH23,'COST' COST,'STMP' STMP)
        )
        WHERE
            post_date <= TO_DATE(TO_CHAR(p_as_at_date,'yyyyMMdd') || ' 23:59:59', 'yyyyMMdd HH24:mi:ss')
            AND (p_office = 'ALL' OR pol_office = p_office)
            AND (p_class = 'ALL' OR lob_code = p_class)            
        )
        GROUP BY
            branch,policy_no,pol_end_no,
            contract_no,
            plat_no_1,plat_no_2,plat_no_3,co_in_fac_ref_no,fire_conjunction_pol,            
            lob,sob,dc_account_full_name,insured_name,distribution_name,distribution_name2,qq_name,
            end_eff_date,end_exp_date,post_date,aging,curr,exch_rate,
            end_reason,acting_code,tsi,
            pol_inst_no,pol_total_inst,due_date
        ;

        p_status 	:= '1';
        p_error_message := 'ok';
    
        EXCEPTION
            WHEN OTHERS THEN
                p_status 	:= '0';
                p_error_message := SUBSTR(SQLERRM, 1, 100);

    END get_rpt_fi_soa_ahass;
    
END PACKAGE_RPT_FI_SOA;