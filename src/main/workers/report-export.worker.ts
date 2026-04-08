import { parentPort } from 'worker_threads'
import {
  exportFinancialReportToExcel,
  ReportExportPayload
} from '../services/ReportExportService'

interface ReportExportTask {
  id: string
  type: 'report-export'
  data: ReportExportPayload
}

interface WorkerMessage {
  task: ReportExportTask
}

const reportComplete = (success: boolean, data?: unknown, error?: string): void => {
  parentPort?.postMessage({
    success,
    result: data,
    error: error ? { code: 'REPORT_EXPORT_ERROR', message: error } : undefined
  })
}

parentPort?.on('message', async (message: WorkerMessage) => {
  const { task } = message

  if (!task || task.type !== 'report-export') {
    reportComplete(false, undefined, 'Invalid task type')
    return
  }

  try {
    const result = await exportFinancialReportToExcel(task.data, (progress) => {
      parentPort?.postMessage({
        type: 'progress',
        ...progress
      })
    })

    reportComplete(true, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reportComplete(false, undefined, message)
  }
})
