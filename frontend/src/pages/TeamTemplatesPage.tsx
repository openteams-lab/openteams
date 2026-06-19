import {
  BarChart3,
  ChevronRight,
  Code2,
  FlaskConical,
  Hexagon,
  Megaphone,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

type TemplateCard = {
  categoryKey: string;
  descKey: string;
  icon: LucideIcon;
  titleKey: string;
};

const teamTemplates: TemplateCard[] = [
  {
    categoryKey: "teamTemplates.category.development",
    descKey: "teamTemplates.card.apiContract.desc",
    icon: Code2,
    titleKey: "teamTemplates.card.apiContract.title",
  },
  {
    categoryKey: "teamTemplates.category.marketing",
    descKey: "teamTemplates.card.socialTracking.desc",
    icon: Megaphone,
    titleKey: "teamTemplates.card.socialTracking.title",
  },
  {
    categoryKey: "teamTemplates.category.research",
    descKey: "teamTemplates.card.experimentRecord.desc",
    icon: FlaskConical,
    titleKey: "teamTemplates.card.experimentRecord.title",
  },
];

const professionalTemplates: TemplateCard[] = [
  {
    categoryKey: "teamTemplates.category.operations",
    descKey: "teamTemplates.card.fullLinkAnalytics.desc",
    icon: BarChart3,
    titleKey: "teamTemplates.card.fullLinkAnalytics.title",
  },
  {
    categoryKey: "teamTemplates.category.development",
    descKey: "teamTemplates.card.releasePipeline.desc",
    icon: Hexagon,
    titleKey: "teamTemplates.card.releasePipeline.title",
  },
];

function TeamTemplatesHeader({ t }: { t: TranslateFn }) {
  const systemBreadcrumbLabel = t("agents.breadcrumb.system");

  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-2)] px-[29px]">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-[7px]"
      >
        <span
          role="img"
          aria-label={systemBreadcrumbLabel}
          title={systemBreadcrumbLabel}
          className="flex h-[19px] w-[19px] shrink-0 items-center justify-center text-[var(--primary)]"
        >
          <Settings aria-hidden="true" className="h-[17px] w-[17px]" />
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="truncate text-[16px] font-semibold leading-none text-[var(--ink)]">
          {t("page.team-templates")}
        </h1>
      </nav>

      <div className="flex min-w-0 items-center" />
    </header>
  );
}

function TemplateCardView({
  template,
  t,
}: {
  template: TemplateCard;
  t: TranslateFn;
}) {
  const Icon = template.icon;

  return (
    <article
      className="team-template-card group relative flex min-h-[92px] items-start gap-4 rounded-[8px] p-5 text-left"
    >
      <span className="team-template-icon mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="min-w-0 truncate text-[15px] font-bold leading-tight text-[var(--team-template-title)]">
            {t(template.titleKey)}
          </h3>
          <span className="team-template-tag inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium leading-none">
            {t(template.categoryKey)}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-1 text-[14px] leading-[1.45] text-[var(--team-template-description)]">
          {t(template.descKey)}
        </p>
      </div>
    </article>
  );
}

function CustomTemplatePlaceholder({ t }: { t: TranslateFn }) {
  return (
    <div className="team-template-custom-card flex min-h-[92px] items-center justify-center rounded-[8px] p-5 text-center text-[var(--team-template-title)]">
      <div className="flex items-center gap-3">
        <Plus aria-hidden="true" className="h-4 w-4" />
        <span className="text-[13px] font-semibold leading-none">
          {t("teamTemplates.custom")}
        </span>
      </div>
    </div>
  );
}

function TemplateSection({
  count,
  children,
  premium,
  title,
  t,
}: {
  children: ReactNode;
  count: number;
  premium?: boolean;
  title: string;
  t: TranslateFn;
}) {
  return (
    <section>
      <div className="mb-4 flex min-w-0 items-center gap-3">
        <h2 className="shrink-0 text-[13px] font-semibold leading-none text-[var(--ink-subtle)]">
          {t(title, { count })}
        </h2>
        {premium && (
          <span className="team-template-upgrade-badge shrink-0 rounded-full bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_36%,transparent),color-mix(in_srgb,var(--success)_26%,transparent))] p-px">
            <span className="block rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium leading-none text-[var(--primary)]">
              {t("teamTemplates.upgradeAvailable")}
            </span>
          </span>
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

export function TeamTemplatesPage() {
  const { t } = useWorkspace();

  return (
    <div className="team-template-page flex h-full min-h-0 flex-col overflow-hidden text-[var(--ink)]">
      <TeamTemplatesHeader t={t} />

      <main className="min-h-0 flex-1 overflow-y-auto ot-scroll-area-styled">
        <div className="flex w-full flex-col gap-7 px-5 pb-4 pt-4 lg:px-6">
          <section className="team-template-status-bar flex min-w-0 items-center gap-2 text-[13px]">
            <span className="team-template-status-dot shrink-0" />
            <span className="font-medium text-[var(--ink-subtle)]">
              {t("teamTemplates.current.label")}
            </span>
            <strong className="min-w-0 truncate font-semibold text-[var(--ink)]">
              {t("teamTemplates.current.name")}
            </strong>
          </section>

          <TemplateSection
            count={teamTemplates.length + 1}
            title="teamTemplates.section.mine"
            t={t}
          >
            {teamTemplates.map((template) => (
              <TemplateCardView
                key={template.titleKey}
                template={template}
                t={t}
              />
            ))}
            <CustomTemplatePlaceholder t={t} />
          </TemplateSection>

          <TemplateSection
            count={professionalTemplates.length}
            premium
            title="teamTemplates.section.professional"
            t={t}
          >
            {professionalTemplates.map((template) => (
              <TemplateCardView
                key={template.titleKey}
                template={template}
                t={t}
              />
            ))}
          </TemplateSection>
        </div>
      </main>
    </div>
  );
}
