import { escapeHtmlText } from '../../app/utils'

export function makeExportHtml(title: string, bodyHtml: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title><style>
    @page{size:A4;margin:8mm;}
    *{box-sizing:border-box;}
    html,body{background:#fff;}
    body{font-family:Arial,"Helvetica Neue",sans-serif;color:#111827;padding:0;margin:0;font-size:10px;line-height:1.25;}
    h1{font-size:18px;line-height:1.15;margin:0 0 7px;font-weight:700;color:#111827;}
    h2{font-size:15px;line-height:1.18;margin:12px 0 7px;font-weight:700;color:#111827;}
    h3{font-size:12px;line-height:1.2;margin:11px 0 5px;font-weight:700;color:#111827;}
    p{margin:0 0 6px;}
    .strict-report-header,.report-print-header{background:transparent!important;border:0!important;border-radius:0!important;padding:0!important;margin:0 0 9px!important;}
    .strict-report-title-row{display:block!important;}
    .strict-report-title-row h2{display:none!important;}
    .strict-report-note,.mini-panel-note,.muted-note,.note{color:#374151;font-size:10px;margin:0 0 7px;line-height:1.25;font-weight:400;}
    .strict-report-period{display:inline-block!important;border:0!important;border-radius:0!important;background:transparent!important;color:#111827!important;padding:0!important;margin:0 0 8px!important;font-size:10px;font-weight:700;}
    .report-export-actions,.button-row,.reports-period-buttons,.actions,.status-pill,.soft-badge,button,select,input,label{display:none!important;}
    .export-hide{display:none!important;}
    .finance-report-shell,.selected-report-shell,.strict-report-shell,#selectedFinanceReportExport,#planReportExport,#teamPlanReportExport{display:block!important;width:100%!important;max-width:100%!important;}
    .summary-grid,.strict-summary-grid,.report-grid,.two-columns{display:block!important;width:100%!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;overflow:visible!important;margin:0 0 8px!important;}
    .summary-card{display:block!important;border:0!important;border-radius:0!important;padding:0!important;margin:0 0 2px!important;box-shadow:none!important;background:transparent!important;min-height:0!important;}
    .summary-card span{display:inline!important;color:#4b5563!important;font-size:9px!important;text-transform:uppercase!important;font-weight:700!important;letter-spacing:.02em!important;margin-right:3px;}
    .summary-card strong{display:inline!important;font-size:11px!important;margin:0!important;color:#111827!important;font-weight:700!important;}
    .report-stat-section{margin:12px 0 14px!important;page-break-inside:avoid;break-inside:avoid;}
    .report-stat-section h3{font-size:15px;margin:0 0 7px;}
    .report-stat-table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 4px;font-size:10px;}
    .report-stat-table th,.report-stat-table td{border:1px solid #111827;padding:5px 6px;text-align:left;vertical-align:middle;word-break:normal;overflow-wrap:break-word;}
    .report-stat-table th{background:#dbe5f1;color:#111827;font-size:9px;font-weight:700;text-transform:none;letter-spacing:0;}
    .report-stat-table td{font-size:10px;}
    .report-table-card,.strict-report-section,.strict-day-card,.report-block{display:block!important;width:100%!important;border:0!important;border-radius:0!important;padding:0!important;margin:14px 0!important;background:transparent!important;box-shadow:none!important;overflow:visible!important;page-break-inside:avoid;break-inside:avoid;}
    .strict-section-head,.strict-day-head{display:block!important;background:transparent!important;border:0!important;border-radius:0!important;padding:0!important;margin:0 0 6px!important;}
    .strict-section-head h3,.strict-day-head strong{display:block!important;font-size:15px!important;margin:0 0 3px!important;color:#111827!important;font-weight:700!important;}
    .strict-day-head span{display:block!important;background:transparent!important;border:0!important;border-radius:0!important;padding:0!important;margin:0!important;color:#374151!important;font-size:10px!important;font-weight:700!important;}
    .table-shell{display:block!important;width:100%!important;max-width:100%!important;overflow:visible!important;margin:0!important;padding:0!important;}
    table{width:100%!important;max-width:100%!important;border-collapse:collapse!important;table-layout:fixed!important;margin:0 0 10px!important;font-size:9.2px!important;page-break-inside:auto;}
    thead{display:table-header-group;}
    tr{page-break-inside:avoid;break-inside:avoid;}
    th,td{border:1px solid #111827!important;padding:4px 5px!important;text-align:left!important;vertical-align:middle!important;word-break:normal!important;overflow-wrap:anywhere!important;white-space:normal!important;color:#111827!important;}
    th{background:#dbe5f1!important;font-weight:700!important;font-size:8.2px!important;text-transform:none!important;letter-spacing:0!important;}
    td.num,th.num,.num{text-align:right!important;white-space:nowrap!important;overflow-wrap:normal!important;word-break:normal!important;}
    tr.total-row td{background:#f2f2f2!important;font-weight:700!important;}
    .stocktake-paper-title{display:flex!important;justify-content:space-between!important;align-items:flex-start!important;gap:14px!important;margin:0 0 9px!important;}
    .stocktake-paper-title h2{margin:0 0 2px!important;font-size:16px!important;}
    .stocktake-paper-title p,.stocktake-paper-signature,.stocktake-paper-note{font-size:10px!important;color:#374151!important;}
    .stocktake-paper-signature{white-space:nowrap!important;padding-top:2px!important;}
    .stocktake-paper-note{margin:0 0 10px!important;padding:6px 7px!important;border:1px solid #777!important;}
    .stocktake-paper-product{page-break-inside:auto!important;break-inside:auto!important;margin:0 0 12px!important;}
    .stocktake-paper-product-title{display:flex!important;justify-content:space-between!important;align-items:baseline!important;gap:10px!important;margin:10px 0 4px!important;padding:0 0 3px!important;border-bottom:1.5px solid #111827!important;break-after:avoid-page!important;page-break-after:avoid!important;}
    .stocktake-paper-product-title h2{font-size:14px!important;margin:0!important;padding:0!important;border:0!important;}
    .stocktake-paper-product-title span{font-size:9px!important;font-weight:700!important;white-space:nowrap!important;color:#374151!important;}
    .stocktake-paper-position{page-break-inside:auto!important;break-inside:auto!important;margin:0 0 8px!important;}
    .stocktake-paper-position>h3{font-size:10px!important;margin:0 0 4px!important;color:#374151!important;break-after:avoid-page!important;page-break-after:avoid!important;}
    .stocktake-paper-position table{margin:0 0 7px!important;font-size:10px!important;}
    .stocktake-paper-position thead{display:table-header-group!important;}
    .stocktake-paper-position tr{break-inside:avoid!important;page-break-inside:avoid!important;}
    .stocktake-paper-position th,.stocktake-paper-position td{padding:5px 5px!important;}
    .stocktake-paper-position .paper-no{width:8%!important;text-align:center!important;white-space:nowrap!important;}
    .stocktake-paper-position .paper-qty{width:10%!important;text-align:center!important;white-space:nowrap!important;}
    .stocktake-paper-position .paper-fact{width:15%!important;height:32px!important;text-align:center!important;}
    .stocktake-paper-position .paper-comment{width:24%!important;}
    .empty-state{border:0!important;background:transparent!important;color:#374151!important;padding:4px 0!important;margin:0!important;text-align:left!important;font-size:10px!important;}
  </style></head><body><h1>${escapeHtmlText(title)}</h1>${bodyHtml}</body></html>`
}

export function downloadBlobFile(blob: Blob, filename: string) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
