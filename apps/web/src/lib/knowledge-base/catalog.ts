export type KnowledgeLicensingMode =
  | "public_ingest"
  | "metadata_only"
  | "restricted";

export type KnowledgeSourceType =
  | "portal"
  | "act"
  | "regulation"
  | "guidance"
  | "code"
  | "standard_reference";

export type KnowledgeCollectionPriority =
  | "foundation"
  | "recommended"
  | "optional";

export type KnowledgeCollectionTarget = {
  id: string;
  title: string;
  jurisdictionCountry: "Australia";
  jurisdictionRegion:
    | "Federal"
    | "NSW"
    | "VIC"
    | "QLD"
    | "WA"
    | "SA"
    | "TAS"
    | "ACT"
    | "NT";
  regulator: string;
  officialUrl: string;
  sourceType: KnowledgeSourceType;
  licensingMode: KnowledgeLicensingMode;
  priority: KnowledgeCollectionPriority;
  industries: string[];
  topics: string[];
  notes: string;
  documentsToCollect: string[];
};

export const AUSTRALIAN_KNOWLEDGE_COLLECTION_TARGETS: KnowledgeCollectionTarget[] =
  [
    {
      id: "au-federal-legislation-portal",
      title: "Federal legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "Federal",
      regulator: "Federal Register of Legislation",
      officialUrl: "https://www.legislation.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["legislation", "federal law", "regulations", "consumer law"],
      notes:
        "Primary federal source for Commonwealth Acts, regulations, and legislative instruments that affect trade, employment, safety, and consumer obligations.",
      documentsToCollect: [
        "Competition and Consumer Act / Australian Consumer Law materials relevant to quoting, warranties, and unfair practices",
        "Federal employment and privacy instruments only where they affect service businesses",
        "Any Commonwealth instruments directly referenced by state building or safety schemes",
      ],
    },
    {
      id: "au-federal-ncc",
      title: "National Construction Code and ABCB guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "Federal",
      regulator: "Australian Building Codes Board",
      officialUrl: "https://ncc.abcb.gov.au/",
      sourceType: "code",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing"],
      topics: ["national construction code", "building code", "performance requirements"],
      notes:
        "Core public code source for Australian building and plumbing requirements, including NCC editions, state variations, and public guidance.",
      documentsToCollect: [
        "Current NCC volumes and state/territory variations that are publicly accessible",
        "ABCB practitioner guidance, explanatory materials, and adoption notes",
        "Plumbing Code of Australia public materials bundled with the NCC",
      ],
    },
    {
      id: "au-federal-whs-model",
      title: "Model WHS laws and codes of practice",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "Federal",
      regulator: "Safe Work Australia",
      officialUrl: "https://www.safeworkaustralia.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["work health and safety", "codes of practice", "high risk work"],
      notes:
        "National model WHS laws and codes of practice used as the common baseline for state and territory WHS regimes.",
      documentsToCollect: [
        "Model WHS Act",
        "Model WHS Regulations",
        "Construction, electrical, asbestos, excavation, hazardous manual tasks, and other trade-relevant model codes of practice",
      ],
    },
    {
      id: "au-federal-standards-reference",
      title: "Standards references registry",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "Federal",
      regulator: "Standards Australia / referenced by legislation",
      officialUrl: "https://store.standards.org.au/",
      sourceType: "standard_reference",
      licensingMode: "metadata_only",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["standards", "referenced standards", "paywalled technical code"],
      notes:
        "Track standards as metadata and references now. Full text should only be ingested later if licensed.",
      documentsToCollect: [
        "AS/NZS 3500 plumbing and drainage references",
        "AS/NZS 3000 wiring rules references",
        "Gas installation and appliance standards referenced by state law",
        "Any NCC-referenced or regulator-referenced standards needed by your target trades",
      ],
    },
    {
      id: "au-nsw-legislation-portal",
      title: "NSW legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NSW",
      regulator: "NSW Legislation",
      officialUrl: "https://legislation.nsw.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "home building", "security of payment"],
      notes:
        "Primary NSW source for Acts and regulations affecting building work, contractor obligations, licensing, and construction payment frameworks.",
      documentsToCollect: [
        "Home Building Act and regulations",
        "Building and Development Certifiers or equivalent compliance-related legislation where relevant",
        "Security of Payment legislation",
        "Any NSW-specific plumbing, gasfitting, or contractor licensing regulations",
      ],
    },
    {
      id: "au-nsw-building-regulator",
      title: "NSW housing and construction regulator guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NSW",
      regulator: "NSW Government Housing and Construction",
      officialUrl: "https://www.nsw.gov.au/housing-and-construction",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing"],
      topics: ["licensing", "residential building", "defects", "compliance"],
      notes:
        "Public regulator guidance for building work, contractor obligations, defects, licensing expectations, and consumer-facing compliance.",
      documentsToCollect: [
        "Builder and tradesperson licensing guidance",
        "Residential building obligations and defect guidance",
        "Any public plumbing/drainage compliance guidance",
      ],
    },
    {
      id: "au-nsw-whs-regulator",
      title: "SafeWork NSW guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NSW",
      regulator: "SafeWork NSW",
      officialUrl: "https://www.safework.nsw.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "electrical safety", "high-risk work"],
      notes:
        "NSW-specific WHS guidance, notices, and codes relevant to construction and service trades.",
      documentsToCollect: [
        "Construction safety guidance",
        "Excavation, confined space, working at heights, and asbestos guidance",
        "NSW notices or guidance that supplement model WHS materials",
      ],
    },
    {
      id: "au-nsw-energy-gas",
      title: "NSW energy, electrical, and gas safety guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NSW",
      regulator: "NSW energy and utility safety sources",
      officialUrl: "https://www.energy.nsw.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "recommended",
      industries: ["electrical", "gas", "hvac"],
      topics: ["electrical safety", "gas safety", "appliances", "network rules"],
      notes:
        "Use alongside NSW legislation and regulator sources for gas, electrical, and appliance-related obligations.",
      documentsToCollect: [
        "Gasfitting and gas safety guidance",
        "Electrical installation and compliance guidance",
        "Any public notices affecting field work or compliance",
      ],
    },
    {
      id: "au-vic-legislation-portal",
      title: "Victoria legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "VIC",
      regulator: "Victorian Legislation",
      officialUrl: "https://www.legislation.vic.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "domestic building", "licensing"],
      notes:
        "Primary Victorian legislation source for building, plumbing, electrical safety, gas safety, and domestic building obligations.",
      documentsToCollect: [
        "Building Act and Building Regulations",
        "Domestic Building Contracts legislation",
        "Plumbing, electrical, and gas safety legislation and subordinate instruments",
      ],
    },
    {
      id: "au-vic-building-regulator",
      title: "Victorian Building Authority guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "VIC",
      regulator: "Victorian Building Authority",
      officialUrl: "https://www.vba.vic.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing"],
      topics: ["builder registration", "plumber registration", "technical guidance"],
      notes:
        "Public VBA guidance for practitioner obligations, registrations, plumbing compliance, and building practice.",
      documentsToCollect: [
        "Registration and licensing guidance for builders and plumbers",
        "Technical guidance, practice notes, and plumbing advisory notes",
        "Public disciplinary or compliance guidance where relevant",
      ],
    },
    {
      id: "au-vic-whs-regulator",
      title: "WorkSafe Victoria guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "VIC",
      regulator: "WorkSafe Victoria",
      officialUrl: "https://www.worksafe.vic.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["ohs", "construction safety", "codes of practice"],
      notes:
        "Victorian OHS and construction safety guidance layered on top of the statutory framework.",
      documentsToCollect: [
        "OHS guidance relevant to construction and trade work",
        "Construction-specific compliance guidance, notices, and codes",
      ],
    },
    {
      id: "au-vic-energy-gas",
      title: "Energy Safe Victoria guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "VIC",
      regulator: "Energy Safe Victoria",
      officialUrl: "https://www.esv.vic.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "recommended",
      industries: ["electrical", "gas", "hvac"],
      topics: ["electrical safety", "gas safety", "compliance certificates"],
      notes:
        "Victorian source for electrical and gas technical/compliance guidance.",
      documentsToCollect: [
        "Electrical safety guidance and compliance certificate rules",
        "Gas safety and gasfitting guidance",
        "Public safety alerts and practice guidance",
      ],
    },
    {
      id: "au-qld-legislation-portal",
      title: "Queensland legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "QLD",
      regulator: "Queensland Legislation",
      officialUrl: "https://www.legislation.qld.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "plumbing and drainage", "building"],
      notes:
        "Primary Queensland legislation source for building, plumbing and drainage, electrical safety, WHS, and construction payment obligations.",
      documentsToCollect: [
        "Building Act and regulations",
        "Plumbing and Drainage Act and regulations",
        "Electrical Safety Act and regulations",
        "Queensland WHS legislation",
        "Building Industry Fairness / security of payment legislation where relevant",
      ],
    },
    {
      id: "au-qld-building-regulator",
      title: "QBCC building and plumbing guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "QLD",
      regulator: "Queensland Building and Construction Commission",
      officialUrl: "https://www.qbcc.qld.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing"],
      topics: ["licensing", "building work", "plumbing", "consumer protection"],
      notes:
        "Core Queensland public regulator guidance for licences, scopes of work, complaints, and building/plumbing compliance.",
      documentsToCollect: [
        "QBCC licensing guides",
        "Plumbing and building compliance guidance",
        "Scope of work, defects, and consumer protection guidance",
      ],
    },
    {
      id: "au-qld-whs-regulator",
      title: "WorkSafe Queensland guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "QLD",
      regulator: "WorkSafe Queensland",
      officialUrl: "https://www.worksafe.qld.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "codes of practice"],
      notes:
        "Queensland workplace health and safety guidance and codes relevant to trade and field work.",
      documentsToCollect: [
        "Queensland codes of practice and guidance for construction work",
        "Excavation, heights, confined spaces, electrical risk, and asbestos guidance",
      ],
    },
    {
      id: "au-qld-electrical-gas",
      title: "Queensland electrical and gas safety guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "QLD",
      regulator: "Electrical Safety Office and related Queensland safety sources",
      officialUrl: "https://www.worksafe.qld.gov.au/electrical-safety",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "recommended",
      industries: ["electrical", "gas", "hvac"],
      topics: ["electrical safety", "gas safety", "compliance"],
      notes:
        "Electrical Safety Office guidance plus connected Queensland safety material for electrical and gas trade obligations.",
      documentsToCollect: [
        "Electrical licensing and safety guidance",
        "Electrical testing, compliance, and incident guidance",
        "Public gasfitting/gas safety material available from Queensland official sources",
      ],
    },
    {
      id: "au-wa-legislation-portal",
      title: "Western Australia legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "WA",
      regulator: "WA Legislation",
      officialUrl: "https://www.legislation.wa.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "building services", "plumbing licensing"],
      notes:
        "Primary WA legislation source for building services, plumbing licensing, electrical and gas frameworks, and safety obligations.",
      documentsToCollect: [
        "Building Services legislation",
        "Plumbers Licensing legislation",
        "Electricity and gas safety legislation",
        "Construction contracts / payment legislation where relevant",
      ],
    },
    {
      id: "au-wa-building-energy",
      title: "WA Building and Energy guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "WA",
      regulator: "Building and Energy WA",
      officialUrl: "https://www.commerce.wa.gov.au/building-and-energy",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas"],
      topics: ["licensing", "plumbing", "building services", "electrical", "gas"],
      notes:
        "WA public guidance across building services, plumbing licensing, electrical safety, and gas safety.",
      documentsToCollect: [
        "Building services board and licensing guidance",
        "Plumbing licensing and technical guidance",
        "Electrical and gas safety public compliance materials",
      ],
    },
    {
      id: "au-wa-whs-regulator",
      title: "WorkSafe WA guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "WA",
      regulator: "WorkSafe WA",
      officialUrl: "https://www.commerce.wa.gov.au/worksafe",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "codes of practice"],
      notes:
        "WA-specific work health and safety guidance for construction and trade operations.",
      documentsToCollect: [
        "Construction safety codes and guidance",
        "Plant, excavation, heights, and hazardous work guidance",
      ],
    },
    {
      id: "au-sa-legislation-portal",
      title: "South Australia legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "SA",
      regulator: "South Australian Legislation",
      officialUrl: "https://www.legislation.sa.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "building work", "occupational licensing"],
      notes:
        "Primary SA legislation source for building work, occupational licensing, WHS, and utility safety obligations.",
      documentsToCollect: [
        "Development / building legislation",
        "Occupational licensing legislation for builders, plumbers, gas fitters, and electricians",
        "SA WHS and utility safety legislation",
      ],
    },
    {
      id: "au-sa-building-trades",
      title: "Consumer and Business Services building and trades guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "SA",
      regulator: "Consumer and Business Services",
      officialUrl: "https://www.cbs.sa.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas"],
      topics: ["licensing", "trade registration", "consumer rules"],
      notes:
        "South Australian public source for trade licensing, registration, and consumer-facing obligations.",
      documentsToCollect: [
        "Licensing and registration guidance for builders and trade contractors",
        "Plumbing, gasfitting, and electrical licence guidance",
        "Consumer contract and warranty guidance",
      ],
    },
    {
      id: "au-sa-whs-regulator",
      title: "SafeWork SA guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "SA",
      regulator: "SafeWork SA",
      officialUrl: "https://www.safework.sa.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "codes of practice"],
      notes:
        "South Australian WHS regulator guidance and construction safety materials.",
      documentsToCollect: [
        "Construction safety guidance and codes of practice",
        "Hazard-specific WHS guidance relevant to field trades",
      ],
    },
    {
      id: "au-sa-electrical-gas-plumbing",
      title: "SA electrical, gas, and plumbing safety guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "SA",
      regulator: "SA.GOV.AU trade safety sources",
      officialUrl:
        "https://www.sa.gov.au/topics/energy-and-environment/electrical-gas-and-plumbing-safety",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "recommended",
      industries: ["plumbing", "electrical", "gas", "hvac"],
      topics: ["electrical safety", "gas safety", "plumbing safety"],
      notes:
        "Public South Australian guidance for electrical, gas, and plumbing safety obligations.",
      documentsToCollect: [
        "Electrical safety public guidance",
        "Gas appliance and gasfitting public guidance",
        "Plumbing safety and compliance guidance",
      ],
    },
    {
      id: "au-tas-legislation-portal",
      title: "Tasmania legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "TAS",
      regulator: "Tasmanian Legislation",
      officialUrl: "https://www.legislation.tas.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "building", "plumbing", "occupational licensing"],
      notes:
        "Primary Tasmanian legislation source for building, plumbing, electrical, gas, and WHS requirements.",
      documentsToCollect: [
        "Building and plumbing legislation",
        "Occupational licensing legislation for key trades",
        "Tasmanian WHS and utility safety legislation",
      ],
    },
    {
      id: "au-tas-cbos",
      title: "Tasmania CBOS building and occupational licensing guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "TAS",
      regulator: "Consumer, Building and Occupational Services",
      officialUrl: "https://www.cbos.tas.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas"],
      topics: ["licensing", "plumbing", "building practitioner rules"],
      notes:
        "Tasmanian public regulator guidance for building and occupational licensing including plumbing-related practice material.",
      documentsToCollect: [
        "Builder and trade licensing guidance",
        "Plumbing practice, permits, and compliance guidance",
        "Public consumer and contract guidance affecting trade work",
      ],
    },
    {
      id: "au-tas-whs-regulator",
      title: "WorkSafe Tasmania guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "TAS",
      regulator: "WorkSafe Tasmania",
      officialUrl: "https://www.worksafe.tas.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "codes of practice"],
      notes:
        "Tasmanian construction and trade WHS guidance.",
      documentsToCollect: [
        "Construction safety and hazard guidance",
        "Tasmanian codes and notices relevant to trade work",
      ],
    },
    {
      id: "au-act-legislation-portal",
      title: "ACT legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "ACT",
      regulator: "ACT Legislation Register",
      officialUrl: "https://www.legislation.act.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "construction occupations", "building"],
      notes:
        "Primary ACT legislation source for building, construction occupations, planning, and safety rules.",
      documentsToCollect: [
        "Building Act and regulations",
        "Construction Occupations legislation",
        "ACT WHS legislation",
        "Electrical, gas, and plumbing legislative instruments where applicable",
      ],
    },
    {
      id: "au-act-building-regulator",
      title: "Access Canberra building and construction guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "ACT",
      regulator: "Access Canberra",
      officialUrl: "https://www.accesscanberra.act.gov.au/building-and-construction",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing"],
      topics: ["licensing", "permits", "certification", "building rules"],
      notes:
        "ACT public guidance for construction occupations, building approvals, and practical compliance steps.",
      documentsToCollect: [
        "Construction occupation licensing guidance",
        "Building approvals, certification, and permit guidance",
        "Public plumbing/building compliance guidance",
      ],
    },
    {
      id: "au-act-whs-regulator",
      title: "WorkSafe ACT guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "ACT",
      regulator: "WorkSafe ACT",
      officialUrl: "https://www.worksafe.act.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "codes of practice"],
      notes:
        "ACT work safety guidance relevant to construction and field service work.",
      documentsToCollect: [
        "Construction safety guidance",
        "Hazard guidance and ACT-specific WHS notices/codes",
      ],
    },
    {
      id: "au-nt-legislation-portal",
      title: "Northern Territory legislation portal",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NT",
      regulator: "Northern Territory Legislation Database",
      officialUrl: "https://legislation.nt.gov.au/",
      sourceType: "portal",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["acts", "regulations", "building", "occupational licensing"],
      notes:
        "Primary NT legislation source for building, plumbing, electrical, gas, occupational, and safety obligations.",
      documentsToCollect: [
        "Building legislation and regulations",
        "Plumbing, electrical, and gas licensing legislation",
        "NT WHS legislation",
      ],
    },
    {
      id: "au-nt-licensing-guidance",
      title: "NT licensing and trade guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NT",
      regulator: "Northern Territory Government licensing sources",
      officialUrl: "https://nt.gov.au/industry/licences",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas"],
      topics: ["licensing", "trade registration", "builder rules"],
      notes:
        "Use NT official licensing sources for builders, plumbers, drainers, gasfitters, and electricians.",
      documentsToCollect: [
        "Builder licensing guidance",
        "Plumbing/draining/gasfitting licensing guidance",
        "Electrical worker/contractor licensing guidance",
      ],
    },
    {
      id: "au-nt-whs-regulator",
      title: "NT WorkSafe guidance",
      jurisdictionCountry: "Australia",
      jurisdictionRegion: "NT",
      regulator: "NT WorkSafe",
      officialUrl: "https://worksafe.nt.gov.au/",
      sourceType: "guidance",
      licensingMode: "public_ingest",
      priority: "foundation",
      industries: ["building", "construction", "plumbing", "electrical", "gas", "hvac"],
      topics: ["whs", "construction safety", "codes of practice"],
      notes:
        "Northern Territory WHS guidance for construction and service trades.",
      documentsToCollect: [
        "Construction safety guidance",
        "Hazard guidance and any NT-specific codes/public notices",
      ],
    },
  ];
