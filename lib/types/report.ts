// lib/types/report.ts

export interface ReportConfig {
  title: string;
  companyName: string;
  reportPeriod: string;
  businessModel?: string;
  // Fitness Studio sections
  executiveOverview?: {
    enabled: boolean;
    cards: {
      activeMembers: boolean;
      monthlyRevenue: boolean;
      netIncome: boolean;
      utilizationRate: boolean;
      monthlyChurnRate: boolean;
      cashRunway: boolean;
    };
    charts: {
      membersOverTime: boolean;
      revenueTrend: boolean;
    };
  };
  studioPerformance?: {
    enabled: boolean;
    cards: {
      activeMembers: boolean;
      newMembers: boolean;
      churnRate: boolean;
      avgMemberTenure: boolean;
      revenuePerMember: boolean;
      utilizationRate: boolean;
      cancellationRate: boolean;
      noShowRate: boolean;
    };
    charts: {
      newVsChurned: boolean;
      churnRateTrend: boolean;
      revenuePerMemberTrend: boolean;
      utilizationHeatmap: boolean;
    };
  };
  classesUtilization?: {
    enabled: boolean;
    cards: {
      totalClassesHeld: boolean;
      avgClassOccupancy: boolean;
      capacityUtilization: boolean;
      avgAttendeesPerClass: boolean;
      revenuePerClass: boolean;
    };
    charts: {
      occupancyTrend: boolean;
      utilizationTrend: boolean;
      classOutcomes: boolean;
      top10ClassesByOccupancy: boolean;
      top10ClassesByRevenue: boolean;
    };
  };
  members?: {
    enabled: boolean;
    cards: {
      totalMembers: boolean;
      activeMembers: boolean;
      netMemberGrowth: boolean;
      avgMemberTenure: boolean;
      engagementRate: boolean;
    };
    charts: {
      memberBaseOverTime: boolean;
      tenureDistribution: boolean;
      subscriptionTypeSplit: boolean;
      genderSplit: boolean;
      ageBands: boolean;
      engagementDistribution: boolean;
    };
  };
  instructors?: {
    enabled: boolean;
    cards: {
      activeInstructors: boolean;
      classesTaught: boolean;
      avgOccupancyPerInstructor: boolean;
      revenuePerInstructor: boolean;
      instructorCancellationRate: boolean;
    };
    charts: {
      instructorRankingByRevenue: boolean;
      instructorRankingByOccupancy: boolean;
      classesTaughtPerInstructor: boolean;
      cancellationRateByInstructor: boolean;
    };
  };
  financials?: {
    enabled: boolean;
    cards: {
      totalRevenue: boolean;
      totalCosts: boolean;
      netIncome: boolean;
      grossMargin: boolean;
    };
    charts: {
      revenueTrend: boolean;
      netIncomeTrend: boolean;
      revenueBreakdown: boolean;
      costBreakdown: boolean;
      budgetVsActual: boolean;
    };
  };
  cashFlow?: {
    enabled: boolean;
    cards: {
      netCashFlow: boolean;
      burnRate: boolean;
      runway: boolean;
    };
    charts: {
      inflowsVsOutflows: boolean;
      netCashFlowTrend: boolean;
      cumulativeCashFlow: boolean;
      outflowsByCategory: boolean;
    };
  };
  // Restaurant sections
  restaurantOverview?: {
    enabled: boolean;
    cards: {
      totalRevenue: boolean;
      covers: boolean;
      averageTicketSize: boolean;
      primeCostPercent: boolean;
      totalCOGS: boolean;
      totalLabor: boolean;
      primeCost: boolean;
    };
    charts: {
      salesTrend: boolean;
    };
  };
  revenueMenu?: {
    enabled: boolean;
    cards: Record<string, boolean>;
    charts: {
      salesTrends: boolean;
      categoryBreakdown: boolean;
      channelBreakdown: boolean;
      topItems: boolean;
      bottomItems: boolean;
    };
  };
  operations?: {
    enabled: boolean;
    cards: {
      tableUtilization: boolean;
      reservationsEffectiveness: boolean;
    };
    charts: {
      coversByDay: boolean;
      coversByHour: boolean;
      peakTimes: boolean;
    };
  };
  restaurantCashFlow?: {
    enabled: boolean;
    cards: {
      netCashFlow: boolean;
      burnRate: boolean;
      cashBalance: boolean;
      cashRunway: boolean;
    };
    charts: {
      cashFlowOverview: boolean;
      inflowsByCategory: boolean;
      outflowsByCategory: boolean;
    };
  };
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  title: "Monthly Business Report",
  companyName: "Your Company",
  reportPeriod: (() => {
    const now = new Date();
    return `${now.toLocaleDateString("en-US", {
      month: "long",
    })} ${now.getFullYear()}`;
  })(),
};

export const DEFAULT_FITNESS_STUDIO_CONFIG: ReportConfig = {
  title: "Monthly Business Report",
  companyName: "Your Company",
  reportPeriod: (() => {
    // Default to previous month (more likely to have complete data)
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${lastMonth.toLocaleDateString("en-US", {
      month: "long",
    })} ${lastMonth.getFullYear()}`;
  })(),
  businessModel: "fitness_studio",
  executiveOverview: {
    enabled: true,
    cards: {
      activeMembers: true,
      monthlyRevenue: true,
      netIncome: true,
      utilizationRate: true,
      monthlyChurnRate: true,
      cashRunway: true,
    },
    charts: {
      membersOverTime: true,
      revenueTrend: true,
    },
  },
  studioPerformance: {
    enabled: true,
    cards: {
      activeMembers: true,
      newMembers: true,
      churnRate: true,
      avgMemberTenure: true,
      revenuePerMember: true,
      utilizationRate: true,
      cancellationRate: true,
      noShowRate: true,
    },
    charts: {
      newVsChurned: true,
      churnRateTrend: true,
      revenuePerMemberTrend: true,
      utilizationHeatmap: true,
    },
  },
  classesUtilization: {
    enabled: true,
    cards: {
      totalClassesHeld: true,
      avgClassOccupancy: true,
      capacityUtilization: true,
      avgAttendeesPerClass: true,
      revenuePerClass: true,
    },
    charts: {
      occupancyTrend: true,
      utilizationTrend: true,
      classOutcomes: true,
      top10ClassesByOccupancy: true,
      top10ClassesByRevenue: true,
    },
  },
  members: {
    enabled: true,
    cards: {
      totalMembers: true,
      activeMembers: true,
      netMemberGrowth: true,
      avgMemberTenure: true,
      engagementRate: true,
    },
    charts: {
      memberBaseOverTime: true,
      tenureDistribution: true,
      subscriptionTypeSplit: true,
      genderSplit: true,
      ageBands: true,
      engagementDistribution: true,
    },
  },
  instructors: {
    enabled: true,
    cards: {
      activeInstructors: true,
      classesTaught: true,
      avgOccupancyPerInstructor: true,
      revenuePerInstructor: true,
      instructorCancellationRate: true,
    },
    charts: {
      instructorRankingByRevenue: true,
      instructorRankingByOccupancy: true,
      classesTaughtPerInstructor: true,
      cancellationRateByInstructor: true,
    },
  },
  financials: {
    enabled: true,
    cards: {
      totalRevenue: true,
      totalCosts: true,
      netIncome: true,
      grossMargin: true,
    },
    charts: {
      revenueTrend: true,
      netIncomeTrend: true,
      revenueBreakdown: true,
      costBreakdown: true,
      budgetVsActual: true,
    },
  },
  cashFlow: {
    enabled: true,
    cards: {
      netCashFlow: true,
      burnRate: true,
      runway: true,
    },
    charts: {
      inflowsVsOutflows: true,
      netCashFlowTrend: true,
      cumulativeCashFlow: true,
      outflowsByCategory: true,
    },
  },
};

export const DEFAULT_RESTAURANT_CONFIG: ReportConfig = {
  title: "Monthly Business Report",
  companyName: "Your Company",
  reportPeriod: (() => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${lastMonth.toLocaleDateString("en-US", {
      month: "long",
    })} ${lastMonth.getFullYear()}`;
  })(),
  businessModel: "restaurant",
  restaurantOverview: {
    enabled: true,
    cards: {
      totalRevenue: true,
      covers: true,
      averageTicketSize: true,
      primeCostPercent: true,
      totalCOGS: true,
      totalLabor: true,
      primeCost: true,
    },
    charts: {
      salesTrend: true,
    },
  },
  revenueMenu: {
    enabled: true,
    cards: {},
    charts: {
      salesTrends: true,
      categoryBreakdown: true,
      channelBreakdown: true,
      topItems: true,
      bottomItems: true,
    },
  },
  operations: {
    enabled: true,
    cards: {
      tableUtilization: true,
      reservationsEffectiveness: true,
    },
    charts: {
      coversByDay: true,
      coversByHour: true,
      peakTimes: true,
    },
  },
  restaurantCashFlow: {
    enabled: true,
    cards: {
      netCashFlow: true,
      burnRate: true,
      cashBalance: true,
      cashRunway: true,
    },
    charts: {
      cashFlowOverview: true,
      inflowsByCategory: true,
      outflowsByCategory: true,
    },
  },
};
