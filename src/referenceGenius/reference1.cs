using FinancialReportApi.Application.Repositories;
using FinancialReportApi.Domain.EntitiesOracle;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Oracle.ManagedDataAccess.Client;
using System.Data;

namespace FinancialReportApi.Infrastructure.PersistenceOracle.Repositories;

public class GetMasterDataRepository : IGetMasterDataRepository
{
    private readonly string _connectionString;
    private readonly ILogger<JournalMemoRepository> _logger;

    public GetMasterDataRepository(IConfiguration configuration, ILogger<JournalMemoRepository> logger)
    {
        _connectionString = configuration.GetConnectionString("OraclePackage")
            ?? throw new ArgumentNullException(nameof(configuration), "Oracle connection string is missing.");
        _logger = logger;
    }

    public async Task<GetMasterDataParam> CreateAsync(GetMasterDataParam getMasterDataParam, CancellationToken cancellationToken)
    {
        using (var conn = new OracleConnection(_connectionString))
        {
            await conn.OpenAsync(cancellationToken);

            try
            {
                const string sQuery = "Package_Rpt_Ac_Fi806.get_master_data";

                var cmd = conn.CreateCommand();
                cmd.CommandText = sQuery;
                cmd.CommandType = CommandType.StoredProcedure;

                cmd.Parameters.Add(new OracleParameter("p_year", OracleDbType.Varchar2, 4, getMasterDataParam.Year ?? "", ParameterDirection.Input));
                cmd.Parameters.Add(new OracleParameter("p_from_month", OracleDbType.Varchar2, getMasterDataParam.FromMonth ?? "", ParameterDirection.Input));
                cmd.Parameters.Add(new OracleParameter("p_to_month", OracleDbType.Varchar2, getMasterDataParam.ToMonth, ParameterDirection.Input));
                cmd.Parameters.Add(new OracleParameter("p_userid", OracleDbType.Varchar2, 3, getMasterDataParam.UserId ?? "", ParameterDirection.Input));

                // Output parameters
                cmd.Parameters.Add(new OracleParameter("p_status", OracleDbType.Varchar2, 1) { Direction = ParameterDirection.Output });
                cmd.Parameters.Add(new OracleParameter("p_error_message", OracleDbType.Varchar2, 100) { Direction = ParameterDirection.Output });

                await cmd.ExecuteNonQueryAsync(cancellationToken);
                _logger.LogInformation("Success!");

                getMasterDataParam.Status = cmd.Parameters["p_status"].Value?.ToString() ?? string.Empty;
                getMasterDataParam.ErrorMessage = cmd.Parameters["p_error_message"].Value?.ToString() ?? string.Empty;

                return getMasterDataParam;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Still failing. The issue might be in the Oracle package definition itself.");
                throw;
            }
        }
    }
}