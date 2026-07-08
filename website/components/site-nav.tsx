import Image from 'next/image'
import Link from 'next/link'
import { GitHubIcon } from '@/components/github-icon'

// bump on each release
const VERSION = 'v0.6.0'

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <Image src="/logo.svg" alt="" width={26} height={26} />
            tinbase
          </Link>
          <span className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 py-0.5 pl-2 pr-1 text-[11px] text-zinc-500 sm:inline-flex">
            {VERSION}
            <span
              tabIndex={0}
              title="Alpha — not production-ready yet. Great for local development, prototypes, and embedded/browser use."
              className="cursor-help rounded-full bg-amber-400/15 px-1.5 font-semibold uppercase tracking-wide text-amber-400"
            >
              alpha
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link href="/docs" className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-800/60 hover:text-white">
            Docs
          </Link>
          <Link href="/studio" className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-800/60 hover:text-white">
            Studio
          </Link>
          <Link href="/browser" className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-800/60 hover:text-white">
            Browser
          </Link>
          <a href="/#benchmarks" className="hidden rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-800/60 hover:text-white sm:block">
            Benchmarks
          </a>
          <a
            href="https://github.com/sanketsahu/tinbase"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
          >
            <GitHubIcon /> GitHub
          </a>
        </div>
      </nav>
    </header>
  )
}
