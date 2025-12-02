-- DROP FUNCTION financial_report.calculate_financial_metrics(uuid, int4, int4);

CREATE OR REPLACE FUNCTION financial_report.calculate_financial_metrics(p_run_id uuid, p_year integer, p_month integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_error_count   INTEGER   := 0;
    v_start_time    TIMESTAMP := clock_timestamp();
    v_lock_acquired BOOLEAN   := FALSE;
    v_result        TEXT;
BEGIN
    -- Acquire advisory lock
    v_lock_acquired := financial_report.acquire_calculation_lock(p_year, p_month);

    IF NOT v_lock_acquired THEN
        RAISE EXCEPTION 'Another calculation is already running for year % month %', p_year, p_month;
    END IF;

    BEGIN
        -- Clear existing data for this period
        DELETE
        FROM financial_report.calculated_financial_metrics
        WHERE year = p_year
          AND month = p_month;

        -- Insert/Update run record
        INSERT INTO financial_report.calculation_runs (id, year, month, status, total_steps, started_at,
                                                       completed_steps, error_count, warning_count)
        VALUES (p_run_id, p_year, p_month, 'RUNNING', 5, v_start_time, 0, 0, 0)
        ON CONFLICT (id) DO UPDATE SET status          = 'RUNNING',
                                       started_at      = v_start_time,
                                       completed_steps = 0,
                                       error_count     = 0,
                                       warning_count   = 0;

        -- Step 1: Extract actual from trial balance
        PERFORM financial_report._extract_actuals_from_trial_balance(p_year, p_month, p_run_id);
        UPDATE financial_report.calculation_runs SET completed_steps = 1 WHERE id = p_run_id;

        -- Step 2: Calculate special reserves
        PERFORM financial_report._calculate_special_reserves(p_year, p_month, p_run_id);
        UPDATE financial_report.calculation_runs SET completed_steps = 2 WHERE id = p_run_id;

        -- Step 3: Aggregate actual metrics (creates ALL/branch and ALL/ALL)
        PERFORM financial_report._aggregate_metrics_by_dimensions(p_year, p_month, 'ACTUAL');
        UPDATE financial_report.calculation_runs SET completed_steps = 3 WHERE id = p_run_id;

        -- Step 4: Calculate derived metrics (SIMPLIFIED)
        PERFORM financial_report._calculate_derived_metrics_simple(p_year, p_month, p_run_id);
        UPDATE financial_report.calculation_runs SET completed_steps = 4 WHERE id = p_run_id;

        -- Step 5: Aggregate calculated metrics
        PERFORM financial_report._aggregate_metrics_by_dimensions(p_year, p_month, 'CALCULATED');
        UPDATE financial_report.calculation_runs SET completed_steps = 5 WHERE id = p_run_id;

        -- Get error count
        SELECT COUNT(*)
        INTO v_error_count
        FROM financial_report.calculation_errors
        WHERE run_id = p_run_id
          AND severity IN ('ERROR', 'WARNING');

        -- Update run status
        UPDATE financial_report.calculation_runs
        SET status       = 'COMPLETED',
            completed_at = clock_timestamp(),
            error_count  = v_error_count,
            metadata     = jsonb_build_object(
                    'duration_seconds', EXTRACT(EPOCH FROM clock_timestamp() - v_start_time),
                    'rows_created', (SELECT COUNT(*)
                                     FROM financial_report.calculated_financial_metrics
                                     WHERE year = p_year
                                       AND month = p_month),
                    'optimized_version', true
                           )
        WHERE id = p_run_id;

        v_result := format('Calculation completed. Run ID: %s, Duration: %s, Errors: %s',
                           p_run_id, clock_timestamp() - v_start_time, v_error_count);

    EXCEPTION
        WHEN OTHERS THEN
            UPDATE financial_report.calculation_runs
            SET status       = 'FAILED',
                completed_at = clock_timestamp(),
                metadata     = jsonb_build_object(
                        'error', SQLERRM,
                        'error_detail', SQLSTATE
                               )
            WHERE id = p_run_id;

            IF v_lock_acquired THEN
                PERFORM financial_report.release_calculation_lock(p_year, p_month);
            END IF;

            RAISE;
    END;

    -- Release lock
    IF v_lock_acquired THEN
        PERFORM financial_report.release_calculation_lock(p_year, p_month);
    END IF;

    RETURN v_result;
END;
$function$
;