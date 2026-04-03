import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { appNotification as notification } from './appNotification'

/**
 * Provides consistent next-step guidance across all sections
 */
export const showCompletionWithNextStep = (
  section: 'projects' | 'units' | 'billing' | 'payments' | 'reports',
  action: string,
  navigate: ReturnType<typeof useNavigate>,
  details?: string
): void => {
  const nextStepConfigs = {
    projects: {
      nextAction: 'Add Units',
      description: 'You can now add units to this project.',
      path: '/units',
      buttonLabel: 'Go to Units'
    },
    units: {
      nextAction: 'Generate Letters',
      description: 'You can now generate maintenance letters for these units.',
      path: '/billing',
      buttonLabel: 'Go to Maintenance Letters'
    },
    billing: {
      nextAction: 'Record Payments',
      description: 'Status changes to Paid only after recording payment.',
      path: '/payments',
      buttonLabel: 'Go to Payments'
    },
    payments: {
      nextAction: 'View Reports',
      description: 'Analyze collections in the financial reports.',
      path: '/reports',
      buttonLabel: 'Go to Reports'
    },
    reports: {
      nextAction: 'Export Complete',
      description: 'Financial report has been exported successfully.',
      path: undefined,
      buttonLabel: ''
    }
  }

  const config = nextStepConfigs[section]
  
  notification.success({
    title: action,
    description: (
      <div>
        {details && <div style={{ marginBottom: 8 }}>{details}</div>}
        {config.path && (
          <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <div style={{ fontSize: '12px', color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
              Suggested Next Step: <strong>{config.nextAction}</strong>
            </div>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                notification.destroy()
                navigate(config.path!)
              }}
            >
              {config.buttonLabel}
            </Button>
          </div>
        )}
      </div>
    ),
    duration: 10,
    placement: 'topRight'
  })
}
