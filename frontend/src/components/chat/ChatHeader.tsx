import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"

type ChatHeaderProps = {
  title?: string | undefined
}

export function ChatHeader({ title }: ChatHeaderProps) {
  const { isAuthenticated, signOut } = useAuth()

  return (
    <header className="flex items-center justify-between p-4 border-b w-full">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <h1 className="text-xl font-bold">{title || "GenAIID AgentCore Starter Pack"}</h1>
      </div>
      {isAuthenticated && (
        <Button onClick={() => signOut()} variant="outline" className="ml-auto">
          Logout
        </Button>
      )}
    </header>
  )
}
