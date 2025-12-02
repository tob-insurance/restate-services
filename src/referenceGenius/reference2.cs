using FinancialReportApi.Application.Common;
using FinancialReportApi.Application.Repositories;
using FinancialReportApi.Domain.Entities.Enums;
using FinancialReportApi.Domain.EntitiesOracle;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace FinancialReportApi.Application.Features.DraftFinancialStatementDocuments.CommitDraftFinancialStatementDocument
    .Queue;

public class ProcessCommitmentHandler(
    ILogger<ProcessCommitmentHandler> logger,
    IAppDbContext dbContext,
    IJournalMemoHeaderRepository journalMemoHeaderRepository,
    // IJournalMemoRepository journalMemoRepository,
    IJournalMemoDetailRepository journalMemoDetailRepository
// IGetMasterDataRepository getMasterDataRepository
) : IRequestHandler<ProcessCommitmentRequest, Result>
{
    public async Task<Result> Handle(ProcessCommitmentRequest request, CancellationToken cancellationToken)
    {
        await using IDbContextTransaction t = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var fsd = await dbContext.DraftFinancialStatementDocuments
            .FirstOrDefaultAsync(x => x.Id == request.DraftFinancialStatementDocumentId, cancellationToken);

        if (fsd is null)
        {
            logger.LogWarning("Draft financial statement document not found with ID: {Id}",
                request.DraftFinancialStatementDocumentId);
            return Result.NotFound("Draft financial statement document not found");
        }

        try
        {
            var journalMemorials = await dbContext.JournalMemorials
                .Include(x => x.Items)
                .Where(x => x.DraftFinancialStatementDocumentId == fsd.Id)
                .ToListAsync(cancellationToken);

            // // Validate that all journal memorial items are balanced per branch
            // var unbalancedBranches = journalMemorials
            //     .SelectMany(jm => jm.Items.Select(item => new { jm.BranchCode, item.Value }))
            //     .GroupBy(x => x.BranchCode)
            //     .Select(g => new { BranchCode = g.Key, Total = g.Sum(x => x.Value) })
            //     .Where(g => g.Total != 0)
            //     .ToList();
            //
            // if (unbalancedBranches.Count > 0)
            // {
            //     var errorMessages = unbalancedBranches.Select(b => $"Branch {b.BranchCode} is not balanced. Sum: {b.Total}");
            //     var fullErrorMessage = string.Join("; ", errorMessages);
            //     throw new InvalidOperationException($"Commitment failed: Journal items are not balanced for the following branches: {fullErrorMessage}");
            // }

            if (journalMemorials.Count == 0)
            {
                logger.LogInformation(
                    "No journal memorials found for document {Id}. Closing document without package execution.",
                    fsd.Id);
            }
            else
            {
                var now = SystemClock.Instance.GetCurrentInstant().InUtc();
                foreach (var jm in journalMemorials)
                {
                    if (string.IsNullOrWhiteSpace(jm.BranchCode))
                    {
                        throw new InvalidOperationException(
                            $"Journal memorial BranchCode is required for JournalMemorialId: {jm.Id}");
                    }

                    var memoHeaderParam = new JournalMemoHeaderParam
                    {
                        MemoOffice = jm.BranchCode,
                        MemoType = "M",
                        MemoYear = jm.CustomDateJournalMemorial.Year.ToString("D4"),
                        MemoDate = jm.CustomDateJournalMemorial.ToDateTimeUtc(),
                        MemoRemarks = jm.Description ?? string.Empty,
                        AcctYear = jm.CustomDateJournalMemorial.Year.ToString("D4"),
                        AcctMonth = jm.CustomDateJournalMemorial.Month.ToString("D2"),
                        CreBy = jm.CreatedById.ToString(),
                        ModBy = jm.CreatedById.ToString(),
                        CreDate = now.ToDateTimeUtc(),
                        ModDate = now.ToDateTimeUtc()
                        // CreDate = DateTime.SpecifyKind(now.ToDateTimeUtc(), DateTimeKind.Unspecified),
                        // ModDate = DateTime.SpecifyKind(now.ToDateTimeUtc(), DateTimeKind.Unspecified)
                    };

                    var headerResult =
                        await journalMemoHeaderRepository.CreateAsync(memoHeaderParam, cancellationToken);
                    if (headerResult?.Status != "1")
                    {
                        throw new InvalidOperationException(
                            $"Failed to create journal memo header in Oracle for JM {jm.Id}: {headerResult?.ErrorMessage ?? "Result was null"}");
                    }

                    jm.JournalNo = jm.BranchCode + "-" + "M" + "-" + jm.CustomDateJournalMemorial.Year.ToString("D4") + "-" + headerResult.MemoSequence;

                    if (jm.Items != null)
                    {
                        foreach (var item in jm.Items)
                        {
                            var journalMemoDetailParam = new JournalMemoDetailParam
                            {
                                MemoOffice = jm.BranchCode,
                                MemoType = "M",
                                MemoYear = fsd.Year.ToString("D4"),
                                MemoSequence = headerResult.MemoSequence ?? "",
                                ChartOfAccountCode = item.ChartAccountCode,
                                Description = item.Description ?? $"Journal item for {item.ChartAccountCode}",
                                OrigCurr = "IDR",
                                OrigAmount = item.Value,
                                ExchangeRate = 1.00m,
                                BaseCurr = "IDR",
                                DetailBranch = jm.BranchCode,
                                DetailDivision = item.DivisionCode ?? string.Empty,
                                CreDate = now.ToDateTimeUtc(),
                                CreBy = jm.CreatedById.ToString(),
                                ModDate = now.ToDateTimeUtc(),
                                ModBy = jm.CreatedById.ToString()
                            };
                            var detailResult =
                                await journalMemoDetailRepository.CreateAsync(journalMemoDetailParam,
                                    cancellationToken);
                            if (detailResult?.Status != "1")
                            {
                                throw new InvalidOperationException(
                                    $"Failed to create journal memo detail in Oracle for JM Item {item.Id}: {detailResult?.ErrorMessage ?? "Result was null"}");
                            }
                        }
                    }

                    // var journalMemoParam = new JournalMemoParam
                    // {
                    //     MemoOffice = jm.BranchCode,
                    //     MemoType = "M",
                    //     MemoYear = fsd.Year.ToString("D4"),
                    //     MemoSequence = headerResult.MemoSequence ?? "",
                    //     PostDate = now.ToDateTimeUtc(),
                    //     PostBy = request.UserId.ToString(),
                    // };
                    // var journalMemoResult = await journalMemoRepository.CreateAsync(journalMemoParam, cancellationToken);
                    // if (journalMemoResult?.Status != "1")
                    // {
                    //     throw new InvalidOperationException($"Failed to create journal memo in Oracle for JM {jm.Id}: {journalMemoResult?.ErrorMessage ?? "Result was null"}");
                    // }
                }
            }

            // var getMasterDataParam = new GetMasterDataParam
            // {
            //     Year = fsd.Year.ToString(),
            //     FromMonth = fsd.Month.ToString(),
            //     ToMonth = fsd.Month.ToString(),
            //     UserId = "CNA"
            // // CNA : UserId
            // };
            // var getMasterDataResult = await getMasterDataRepository.CreateAsync(getMasterDataParam, cancellationToken);
            // if (getMasterDataResult?.Status != "1")
            // {
            //     throw new InvalidOperationException($"Failed to get master data from Oracle: {getMasterDataResult?.ErrorMessage ?? "Result was null"}");
            // }

            fsd.Status = DraftFinancialStatementDocumentStatus.Closed;
            fsd.ClosedAt = SystemClock.Instance.GetCurrentInstant().InUtc();
            fsd.UpdatedAt = SystemClock.Instance.GetCurrentInstant().InUtc();
            fsd.UpdatedById = request.UserId;
            dbContext.DraftFinancialStatementDocuments.Update(fsd);
            await dbContext.SaveChangesAsync(cancellationToken);

            await t.CommitAsync(cancellationToken);

            logger.LogInformation("Document {Id} status updated to Closed", fsd.Id);
            return Result.Success();
        }
        catch (Exception e)
        {
            logger.LogError(e, "Failed to process commitment for document {Id}", fsd.Id);
            await t.RollbackAsync(cancellationToken);

            // Revert status in a separate context to ensure it's saved
            fsd.Status = DraftFinancialStatementDocumentStatus.Draft;
            dbContext.DraftFinancialStatementDocuments.Update(fsd);
            await dbContext.SaveChangesAsync(cancellationToken);

            return Result.CriticalError("Failed to process commitment.", e.Message);
        }
    }
}