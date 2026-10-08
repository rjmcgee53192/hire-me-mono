import { Badge, Card, SectionTitle } from "@repo/ui";
import { PROJECTS } from "../lib/projects";

const GITHUB = "https://github.com/rjmcgee53192";

const SKILL_GROUPS: { heading: string; skills: string[] }[] = [
  { heading: "Languages", skills: ["TypeScript", "Python", "SQL"] },
  {
    heading: "Frontend",
    skills: ["React", "Next.js", "Canvas", "Tailwind"],
  },
  {
    heading: "Systems",
    skills: [
      "WebSockets",
      "Real-time simulation",
      "Scheduling & optimization",
      "Observability",
    ],
  },
  {
    heading: "Practices",
    skills: ["Strict typing", "Unit testing", "CI/CD", "Monorepos"],
  },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-grid relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
          <Badge tone="info">Open to senior engineering roles</Badge>
          <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-slate-100 sm:text-6xl">
            Ryan McGee
          </h1>
          <p className="mt-3 text-xl font-medium text-blue-400">
            Senior Full-Stack Software Engineer
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
            I build real-time systems, data-heavy dashboards, and
            infrastructure tooling — engineered, tested, and live.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <a
              href="#projects"
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500"
            >
              View live demos
            </a>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800 px-6 py-3 font-medium text-slate-100 transition-colors hover:bg-slate-700"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Projects */}
      <section id="projects" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16">
        <SectionTitle
          title="Selected work"
          sub="Five production-grade builds. Each one is a live, interactive demo backed by its own tested package — not screenshots."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECTS.map((project, i) => (
            <div
              key={project.slug}
              className="animate-fade-up"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <Card className="card-lift flex h-full flex-col">
                <h3 className="text-lg font-semibold text-slate-100">
                  {project.title}
                </h3>
                <p className="mt-1 text-sm text-slate-300">{project.tagline}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                  <span className="font-medium text-slate-200">Proves:</span>{" "}
                  {project.proves}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-4 pt-5">
                  <a
                    href={project.demoPath}
                    className="text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
                  >
                    Live demo →
                  </a>
                  <a
                    href={project.codeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-slate-400 transition-colors hover:text-slate-200"
                  >
                    Code →
                  </a>
                </div>
              </Card>
            </div>
          ))}

          {/* Hiring card: fills the 6th grid cell on large screens */}
          <div
            className="animate-fade-up"
            style={{ animationDelay: `${PROJECTS.length * 90}ms` }}
          >
            <Card className="card-lift flex h-full flex-col border-dashed">
              <h3 className="text-lg font-semibold text-slate-100">
                Your team could be next
              </h3>
              <p className="mt-1 text-sm text-slate-300">
                I ship real-time features end to end — from the protocol to the
                pixels.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                <span className="font-medium text-slate-200">Proves:</span>{" "}
                I take ownership and deliver working software on schedule.
              </p>
              <div className="mt-auto pt-5">
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
                >
                  Say hello →
                </a>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Skills */}
      <section className="border-t border-slate-800">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <SectionTitle
            title="Toolbox"
            sub="The stack I reach for when the problem demands it."
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SKILL_GROUPS.map((group) => (
              <Card key={group.heading}>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                  {group.heading}
                </h3>
                <ul className="mt-3 space-y-1.5">
                  {group.skills.map((skill) => (
                    <li key={skill} className="text-sm text-slate-400">
                      {skill}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-slate-800">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-100">
            Want to see how I think?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Every demo above runs real code in the browser. Click through,
            break things, and check the source — that&apos;s the interview.
          </p>
          <a
            href="#projects"
            className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500"
          >
            Back to the demos
          </a>
        </div>
      </section>
    </div>
  );
}
