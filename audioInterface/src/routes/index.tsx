import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'


export const Route = createFileRoute('/')({ component: App })

function App() {


  return (
    <div className="min-h-screen">
      <h1>Hi</h1>
      <Button>Click me</Button>
    </div>
  )
}
