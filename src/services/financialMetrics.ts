import { pool } from '../db';

export interface FinancialMetricsResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  rowsAffected?: number;
  message: string;
  runId?: string; // UUID for tracking the calculation run
}

/**
 * Execute PostgreSQL financial metrics calculation
 * This function calls the financial_report.calculate_financial_metrics stored function
 * 
 * @param reportDate - Date in YYYY-MM-DD format
 * @returns Result object with execution details
 */
export async function calculateFinancialMetrics(reportDate: string): Promise<FinancialMetricsResult> {
  const startTime = new Date();
  const maxRetries = 3;
  let lastError: Error | null = null;

  // Parse date to get year and month
  const date = new Date(reportDate);
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // JavaScript months are 0-indexed

  console.log(`🔄 Calculating financial metrics for year: ${year}, month: ${month}`);

  // Retry logic with exponential backoff
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 2s, 4s, 8s
        console.log(`🔁 Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Get a fresh connection from pool
      const client = await pool.connect();
      
      try {
        // Set search_path to financial_report schema
        await client.query('SET search_path TO financial_report');
        
        // Generate UUID for this calculation run
        const runIdResult = await client.query('SELECT gen_random_uuid() as run_id');
        const runId = runIdResult.rows[0].run_id;
        
        console.log(`   Run ID: ${runId}`);
        
        // Call the PostgreSQL function with 3 parameters: run_id (UUID), year (INTEGER), month (INTEGER)
        // Function signature: calculate_financial_metrics(p_run_id UUID, p_year INTEGER, p_month INTEGER)
        let result;
        try {
          result = await client.query(
            'SELECT financial_report.calculate_financial_metrics($1::UUID, $2::INTEGER, $3::INTEGER) as result',
            [runId, year, month]
          );
        } catch (execError: any) {
          // Log detailed error from PostgreSQL function
          console.error(`❌ PostgreSQL function execution failed:`);
          console.error(`   Error: ${execError.message}`);
          console.error(`   Detail: ${execError.detail || 'N/A'}`);
          console.error(`   Hint: ${execError.hint || 'N/A'}`);
          console.error(`   Run ID: ${runId}`);
          
          // Check if this is a data integrity issue (not retryable)
          const isDataError = 
            execError.code === '23502' || // not_null_violation
            execError.code === '23503' || // foreign_key_violation
            execError.code === '23505' || // unique_violation
            execError.code === '23514';   // check_violation
          
          if (isDataError) {
            console.error(`   This is a data integrity error (code: ${execError.code}), not retrying.`);
            client.release();
            
            const endTime = new Date();
            const duration = (endTime.getTime() - startTime.getTime()) / 1000;
            
            return {
              success: false,
              startTime,
              endTime,
              duration,
              message: `Data integrity error: ${execError.message}. Check calculation_runs table for run_id: ${runId}`,
              runId,
            };
          }
          
          // For other errors, throw to trigger retry
          client.release();
          throw execError;
        }
        
        client.release();
        
        const endTime = new Date(); 
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;
        const resultMessage = result.rows[0]?.result || 'Completed';

        console.log(`✅ Financial metrics calculation completed in ${duration} seconds`);
        console.log(`   Result: ${resultMessage}`);

        return {
          success: true,
          startTime,
          endTime,
          duration,
          rowsAffected: result.rowCount || 0,
          message: resultMessage,
          runId,
        };
      } catch (queryError) {
        // Release connection even on error
        try {
          client.release();
        } catch (releaseError) {
          console.warn('⚠️ Failed to release connection:', releaseError);
        }
        throw queryError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const isRetryable = 
        lastError.message.includes('ECONNRESET') ||
        lastError.message.includes('ETIMEDOUT') ||
        lastError.message.includes('Connection terminated');

      if (!isRetryable || attempt === maxRetries) {
        // Not retryable or last attempt
        break;
      }
      
      console.warn(`⚠️ Attempt ${attempt} failed: ${lastError.message}`);
    }
  }

  // All retries failed
  const endTime = new Date();
  const duration = (endTime.getTime() - startTime.getTime()) / 1000;

  console.error('❌ Financial metrics calculation failed after all retries:', lastError);

  return {
    success: false,
    startTime,
    endTime,
    duration,
    message: lastError?.message || 'Unknown error',
  };
}



/**
 * Get calculation run status from PostgreSQL
 * Useful for checking detailed error information
 */
export async function getCalculationRunStatus(runId: string): Promise<{
  status: string;
  completedSteps: number;
  totalSteps: number;
  errorCount: number;
  warningCount: number;
  metadata: any;
} | null> {
  try {
    const client = await pool.connect();
    
    try {
      const result = await client.query(
        `SELECT status, completed_steps, total_steps, error_count, warning_count, metadata
         FROM financial_report.calculation_runs
         WHERE id = $1`,
        [runId]
      );
      
      client.release();
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        status: row.status,
        completedSteps: row.completed_steps,
        totalSteps: row.total_steps,
        errorCount: row.error_count,
        warningCount: row.warning_count,
        metadata: row.metadata,
      };
    } catch (error) {
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Failed to get calculation run status:', error);
    return null;
  }
}

/**
 * Validate date format (YYYY-MM-DD)
 */
export function validateDateFormat(date: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return false;
  }
  
  const parsedDate = new Date(date);
  return !isNaN(parsedDate.getTime());
}
