import type { Dispatch, SetStateAction } from 'react'
import type { FinanceReportType } from '../../app/types'
import { downloadBlobFile, makeExportHtml } from './documentExport'

type ReportExportArgs = {
  planDateFrom: string
  planDateTo: string
  financeReportType: FinanceReportType
  financeDateFrom: string
  financeDateTo: string
  setError: Dispatch<SetStateAction<string | null>>
}

// The same HTML/Word/print pipeline is used for Finance, Plans, Team and
// stocktake. No report value or payment event is recomputed during export.
export function createReportExportActions({
  planDateFrom,
  planDateTo,
  financeReportType,
  financeDateFrom,
  financeDateTo,
  setError,
}: ReportExportArgs) {
  function getExportElementHtml(elementId: string) {
    const element = document.getElementById(elementId)
    if (!element) {
      setError('Сначала сформируй отчёт, потом скачивай его.')
      return ''
    }
    return element.innerHTML
  }

  function downloadWordDocument(filename: string, title: string, bodyHtml: string) {
    const blob = new Blob(['\ufeff', makeExportHtml(title, bodyHtml)], { type: 'application/msword;charset=utf-8' })
    downloadBlobFile(blob, `${filename}.doc`)
  }

  function exportElementWord(elementId: string, filename: string, title: string) {
    const bodyHtml = getExportElementHtml(elementId)
    if (!bodyHtml) return
    downloadWordDocument(filename, title, bodyHtml)
  }

  function printHtmlDocument(title: string, bodyHtml: string) {
    const iframe = document.createElement('iframe')
    iframe.title = title
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.visibility = 'hidden'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc) {
      iframe.remove()
      setError('Не удалось подготовить печать. Попробуйте ещё раз.')
      return
    }

    doc.open()
    doc.write(makeExportHtml(title, bodyHtml))
    doc.close()

    const doPrint = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        window.setTimeout(() => iframe.remove(), 1200)
      } catch {
        iframe.remove()
        setError('Не удалось открыть печать. Проверьте настройки браузера.')
      }
    }

    window.setTimeout(doPrint, 80)
  }

  function printElementPdf(elementId: string, title: string) {
    const bodyHtml = getExportElementHtml(elementId)
    if (!bodyHtml) return
    printHtmlDocument(title, bodyHtml)
  }

    function exportPlanReportWord() {
    exportElementWord('planReportExport', `plan-report-${planDateFrom}-${planDateTo}`, 'План и зарплата')
  }

  function printPlanReportPdf() {
    printElementPdf('planReportExport', 'План и зарплата')
  }

  function printInventoryStocktakePdf() {
    printElementPdf('inventoryStocktakePrint', 'Ревизия остатков')
  }


  function exportTeamPlanReportWord() {
    exportElementWord('teamPlanReportExport', `team-plan-report-${planDateFrom}-${planDateTo}`, 'Выполнение плана команды')
  }

  function printTeamPlanReportPdf() {
    printElementPdf('teamPlanReportExport', 'Выполнение плана команды')
  }

  function getSelectedFinanceReportExportTitle() {
    if (financeReportType === 'payments') return 'Отчёт по способам оплаты'
    if (financeReportType === 'managers') return 'Отчёт менеджеров'
    if (financeReportType === 'products') return 'Отчёт по товарам'
    if (financeReportType === 'cities') return 'Отчёт по городам'
    if (financeReportType === 'returns') return 'Отчёт по возвратам'
    if (financeReportType === 'debts') return 'Отчёт по закрытым долгам'
    if (financeReportType === 'leads') return 'Отчёт по лидам'
    if (financeReportType === 'callCentre') return 'Отчёт Call Centre'
    return 'Отчёт'
  }

  function exportSelectedFinanceReportWord() {
    exportElementWord('selectedFinanceReportExport', `report-${financeReportType}-${financeDateFrom}-${financeDateTo}`, getSelectedFinanceReportExportTitle())
  }

  function printSelectedFinanceReportPdf() {
    printElementPdf('selectedFinanceReportExport', getSelectedFinanceReportExportTitle())
  }

  return {
    printHtmlDocument,
    exportPlanReportWord,
    printPlanReportPdf,
    printInventoryStocktakePdf,
    exportTeamPlanReportWord,
    printTeamPlanReportPdf,
    getSelectedFinanceReportExportTitle,
    exportSelectedFinanceReportWord,
    printSelectedFinanceReportPdf,
  }
}
