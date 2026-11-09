import type { Dispatch, SetStateAction } from 'react'
import type { WorkshopInvoiceRow } from '../../app/types'
import { formatDateShort, htmlEscape } from '../../app/utils'
import { downloadBlobFile, makeExportHtml } from '../export/documentExport'

type WorkshopInvoiceActionsArgs = {
  invoiceRows: WorkshopInvoiceRow[]
  invoiceIsKaspi: boolean
  invoiceTaskCount: number
  invoiceDateFrom: string
  invoiceDateTo: string
  getWorkshopInvoiceDeadlineLabel: (row: WorkshopInvoiceRow) => string
  getWorkshopInvoiceImportanceLabel: (row: WorkshopInvoiceRow) => string
  printHtmlDocument: (title: string, html: string) => void
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
}

// All three export formats share one scope, row order, timing label and title.
// Keep DOM/file side effects at the user action boundary.
export function createWorkshopInvoiceActions({
  invoiceRows,
  invoiceIsKaspi,
  invoiceTaskCount,
  invoiceDateFrom,
  invoiceDateTo,
  getWorkshopInvoiceDeadlineLabel,
  getWorkshopInvoiceImportanceLabel,
  printHtmlDocument,
  setError,
  setMessage,
}: WorkshopInvoiceActionsArgs) {
  function workshopInvoiceDocumentTitle() {
    return invoiceIsKaspi ? 'Накладная КАСПИ МАГАЗИН' : 'Накладная цеха'
  }

  function workshopInvoiceTimingHeader() {
    return invoiceIsKaspi ? 'Срок' : 'Срочность'
  }

  function workshopInvoiceTimingLabel(row: WorkshopInvoiceRow) {
    return invoiceIsKaspi ? getWorkshopInvoiceDeadlineLabel(row) : getWorkshopInvoiceImportanceLabel(row)
  }

  function workshopInvoiceFileStem() {
    return invoiceIsKaspi ? 'workshop-kaspi-invoice' : 'workshop-invoice'
  }

  function buildWorkshopInvoiceText() {
    const lines = [
      workshopInvoiceDocumentTitle(),
      `Период: ${formatDateShort(invoiceDateFrom)} — ${formatDateShort(invoiceDateTo)}`,
      `Позиций в накладной: ${invoiceTaskCount}`,
      '',
      `Изделие | Характеристики | Кол-во | ${workshopInvoiceTimingHeader()} | Комментарий | Заказ`,
      ...invoiceRows.map((row) => [
        row.productName,
        row.characteristics || '—',
        `${row.quantity} шт.`,
        workshopInvoiceTimingLabel(row),
        row.comment || '—',
        row.orderRef || '—',
      ].join(' | ')),
    ]
    return lines.join('\n')
  }

  async function copyWorkshopInvoiceText() {
    const text = buildWorkshopInvoiceText()
    try {
      await navigator.clipboard.writeText(text)
      setMessage(`${workshopInvoiceDocumentTitle()} скопирована в буфер обмена.`)
    } catch {
      setError('Не удалось скопировать накладную. Используйте скачивание Word или PDF.')
    }
  }

  function buildWorkshopInvoiceHtmlTable(rows: WorkshopInvoiceRow[] = invoiceRows, pageLabel = '') {
    const detailRows = rows.map((row) => `
      <tr class="${row.priority === 0 ? 'urgent' : row.priority === 1 ? 'commented' : ''}">
        <td>${htmlEscape(row.productName)}</td>
        <td>${htmlEscape(row.characteristics || '—')}</td>
        <td>${row.quantity}</td>
        <td>${htmlEscape(workshopInvoiceTimingLabel(row))}</td>
        <td>${htmlEscape(row.comment || '—')}</td>
        <td>${htmlEscape(row.orderRef || '—')}</td>
      </tr>`).join('')

    return `
      <style>@page{size:A4 landscape;margin:8mm;}</style>
      <p class="note"><strong>Период:</strong> ${htmlEscape(formatDateShort(invoiceDateFrom))} — ${htmlEscape(formatDateShort(invoiceDateTo))} · позиций в накладной ${invoiceTaskCount}${pageLabel ? ` · ${htmlEscape(pageLabel)}` : ''}</p>
      <table class="data-table strict-report-table">
        <thead><tr><th>Изделие</th><th>Характеристики</th><th>Кол-во</th><th>${htmlEscape(workshopInvoiceTimingHeader())}</th><th>Комментарий</th><th>Заказ</th></tr></thead>
        <tbody>${detailRows || '<tr><td colspan="6">Нет позиций</td></tr>'}</tbody>
      </table>`
  }

  async function exportWorkshopInvoiceWord() {
    if (!invoiceRows.length) return
    try {
      setError(null)
      const {
        AlignmentType,
        Document,
        HeadingLevel,
        PageOrientation,
        Packer,
        Paragraph,
        Table,
        TableCell,
        TableRow,
        TextRun,
        WidthType,
      } = await import('docx')

      const makeCell = (text: string, bold = false) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text, bold, size: 18 })],
          spacing: { after: 0 },
        })],
      })
      const rows = [
        new TableRow({
          tableHeader: true,
          children: ['Изделие', 'Характеристики', 'Кол-во', workshopInvoiceTimingHeader(), 'Комментарий', 'Заказ'].map((text) => makeCell(text, true)),
        }),
        ...invoiceRows.map((row) => new TableRow({
          children: [
            makeCell(row.productName),
            makeCell(row.characteristics || '—'),
            makeCell(String(row.quantity)),
            makeCell(workshopInvoiceTimingLabel(row)),
            makeCell(row.comment || '—'),
            makeCell(row.orderRef || '—'),
          ],
        })),
      ]
      const documentFile = new Document({
        sections: [{
          properties: {
            page: {
              size: { orientation: PageOrientation.LANDSCAPE },
              margin: { top: 500, right: 500, bottom: 500, left: 500 },
            },
          },
          children: [
            new Paragraph({
              text: workshopInvoiceDocumentTitle(),
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 },
            }),
            new Paragraph({
              text: `Период: ${formatDateShort(invoiceDateFrom)} — ${formatDateShort(invoiceDateTo)} · позиций в накладной ${invoiceTaskCount}`,
              spacing: { after: 160 },
            }),
            new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
          ],
        }],
      })
      const blob = await Packer.toBlob(documentFile)
      downloadBlobFile(blob, `${workshopInvoiceFileStem()}-${invoiceDateFrom}-${invoiceDateTo}.docx`)
      setMessage(`${workshopInvoiceDocumentTitle()} Word скачана в формате DOCX.`)
    } catch (err) {
      setError(err instanceof Error ? `Не удалось создать Word: ${err.message}` : 'Не удалось создать файл Word.')
    }
  }

  async function downloadWorkshopInvoicePdf() {
    if (!invoiceRows.length) return
    try {
      setError(null)
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const rowsPerPage = 18
      const chunks: WorkshopInvoiceRow[][] = []
      for (let index = 0; index < invoiceRows.length; index += rowsPerPage) {
        chunks.push(invoiceRows.slice(index, index + rowsPerPage))
      }
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })

      for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
        const iframe = document.createElement('iframe')
        iframe.title = `${workshopInvoiceDocumentTitle()} — страница ${pageIndex + 1}`
        iframe.style.position = 'fixed'
        iframe.style.left = '-20000px'
        iframe.style.top = '0'
        iframe.style.width = '1200px'
        iframe.style.height = '900px'
        iframe.style.border = '0'
        document.body.appendChild(iframe)
        try {
          const doc = iframe.contentWindow?.document
          if (!doc) throw new Error('браузер не подготовил страницу документа')
          doc.open()
          doc.write(makeExportHtml(workshopInvoiceDocumentTitle(), buildWorkshopInvoiceHtmlTable(chunks[pageIndex], `страница ${pageIndex + 1} из ${chunks.length}`)))
          doc.close()
          await new Promise((resolve) => window.setTimeout(resolve, 80))
          const fullHeight = Math.max(700, doc.documentElement.scrollHeight + 24)
          iframe.style.height = `${fullHeight}px`
          const canvas = await html2canvas(doc.body, {
            backgroundColor: '#ffffff',
            logging: false,
            scale: 1.6,
            useCORS: true,
            windowWidth: 1200,
            windowHeight: fullHeight,
          })
          if (pageIndex > 0) pdf.addPage('a4', 'landscape')
          const pageWidth = pdf.internal.pageSize.getWidth()
          const pageHeight = pdf.internal.pageSize.getHeight()
          const margin = 6
          const availableWidth = pageWidth - margin * 2
          const availableHeight = pageHeight - margin * 2
          const ratio = Math.min(availableWidth / canvas.width, availableHeight / canvas.height)
          const imageWidth = canvas.width * ratio
          const imageHeight = canvas.height * ratio
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imageWidth, imageHeight, undefined, 'FAST')
        } finally {
          iframe.remove()
        }
      }

      pdf.save(`${workshopInvoiceFileStem()}-${invoiceDateFrom}-${invoiceDateTo}.pdf`)
      setMessage(`${workshopInvoiceDocumentTitle()} PDF скачана.`)
    } catch (err) {
      setError(err instanceof Error ? `Не удалось создать PDF: ${err.message}` : 'Не удалось создать PDF.')
    }
  }

  function printWorkshopInvoice() {
    const html = buildWorkshopInvoiceHtmlTable().replace(/<script/gi, '&lt;script')
    printHtmlDocument(workshopInvoiceDocumentTitle(), html)
  }

  return {
    buildWorkshopInvoiceText,
    buildWorkshopInvoiceHtmlTable,
    copyWorkshopInvoiceText,
    exportWorkshopInvoiceWord,
    downloadWorkshopInvoicePdf,
    printWorkshopInvoice,
  }
}
