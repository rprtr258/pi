# Core Knowledge Reference

Supporting detail for the areas outlined in the skill's Core Knowledge section. Read the relevant part when working in that area.

### NCR Lifecycle

Every non-conformance follows a controlled lifecycle. Skipping steps creates audit findings and regulatory risk:

- **Identification:** Anyone can initiate. Record: who found it, where (incoming, in-process, final, field), what standard/spec was violated, quantity affected, lot/batch traceability. Tag or quarantine nonconforming material immediately — no exceptions. Physical segregation with red-tag or hold-tag in a designated MRB area. Electronic hold in ERP to prevent inadvertent shipment.
- **Documentation:** NCR number assigned per your QMS numbering scheme. Link to part number, revision, PO/work order, specification clause violated, measurement data (actuals vs. tolerances), photographs, and inspector ID. For FDA-regulated products, records must satisfy 21 CFR 820.90; for automotive, IATF 16949 §8.7.
- **Investigation:** Determine scope — is this an isolated piece or a systemic lot issue? Check upstream and downstream: other lots from the same supplier shipment, other units from the same production run, WIP and finished goods inventory from the same period. Containment actions must happen before root cause analysis begins.
- **Disposition via MRB (Material Review Board):** The MRB typically includes quality, engineering, and manufacturing representatives. For aerospace (AS9100), the customer may need to participate. Disposition options:
  - **Use-as-is:** Part does not meet drawing but is functionally acceptable. Requires engineering justification (concession/deviation). In aerospace, requires customer approval per AS9100 §8.7.1. In automotive, customer notification is typically required. Document the rationale — "because we need the parts" is not a justification.
  - **Rework:** Bring the part into conformance using an approved rework procedure. The rework instruction must be documented, and the reworked part must be re-inspected to the original specification. Track rework costs.
  - **Repair:** Part will not fully meet the original specification but will be made functional. Requires engineering disposition and often customer concession. Different from rework — repair accepts a permanent deviation.
  - **Return to Vendor (RTV):** Issue a Supplier Corrective Action Request (SCAR) or CAR. Debit memo or replacement PO. Track supplier response within agreed timelines. Update supplier scorecard.
  - **Scrap:** Document scrap with quantity, cost, lot traceability, and authorized scrap approval (often requires management sign-off above a dollar threshold). For serialized or safety-critical parts, witness destruction.

### CAPA System

CAPA is the regulatory backbone. FDA cites CAPA deficiencies more than any other subsystem:

- **Initiation:** Not every NCR requires a CAPA. Triggers: repeat non-conformances (same failure mode 3+ times), customer complaints, audit findings, field failures, trend analysis (SPC signals), regulatory observations. Over-initiating CAPAs dilutes resources and creates closure backlogs. Under-initiating creates audit findings.
- **Corrective Action vs. Preventive Action:** Corrective addresses an existing non-conformance and prevents its recurrence. Preventive addresses a potential non-conformance that hasn't occurred yet — typically identified through trend analysis, risk assessment, or near-miss events. FDA expects both; don't conflate them.
- **Writing Effective CAPAs:** The action must be specific, measurable, and address the verified root cause. Bad: "Improve inspection procedures." Good: "Add torque verification step at Station 12 with calibrated torque wrench (±2%), documented on traveler checklist WI-4401 Rev C, effective by 2025-04-15." Every CAPA must have an owner, a target date, and defined evidence of completion.
- **Verification vs. Validation of Effectiveness:** Verification confirms the action was implemented as planned (did we install the poka-yoke fixture?). Validation confirms the action actually prevented recurrence (did the defect rate drop to zero over 90 days of production data?). FDA expects both. Closing a CAPA at verification without validation is a common audit finding.
- **Closure Criteria:** Objective evidence that the corrective action was implemented AND effective. Minimum effectiveness monitoring period: 90 days for process changes, 3 production lots for material changes, or the next audit cycle for system changes. Document the effectiveness data — charts, rejection rates, audit results.
- **Regulatory Expectations:** FDA 21 CFR 820.198 (complaint handling) and 820.90 (nonconforming product) feed into 820.100 (CAPA). IATF 16949 §10.2.3-10.2.6. AS9100 §10.2. ISO 13485 §8.5.2-8.5.3. Each standard has specific documentation and timing expectations.

### Statistical Process Control (SPC)

SPC separates signal from noise. Misinterpreting charts causes more problems than not charting at all:

- **Chart Selection:** X-bar/R for continuous data with subgroups (n=2-10). X-bar/S for subgroups n>10. Individual/Moving Range (I-MR) for continuous data with subgroup n=1 (batch processes, destructive testing). p-chart for proportion defective (variable sample size). np-chart for count of defectives (fixed sample size). c-chart for count of defects per unit (fixed opportunity area). u-chart for defects per unit (variable opportunity area).
- **Capability Indices:** Cp measures process spread vs. specification width (potential capability). Cpk adjusts for centering (actual capability). Pp/Ppk use overall variation (long-term) vs. Cp/Cpk which use within-subgroup variation (short-term). A process with Cp=2.0 but Cpk=0.8 is capable but not centered — fix the mean, not the variation. Automotive (IATF 16949) typically requires Cpk ≥ 1.33 for established processes, Ppk ≥ 1.67 for new processes.
- **Western Electric Rules (signals beyond control limits):** Rule 1: One point beyond 3σ. Rule 2: Nine consecutive points on one side of the center line. Rule 3: Six consecutive points steadily increasing or decreasing. Rule 4: Fourteen consecutive points alternating up and down. Rule 1 demands immediate action. Rules 2-4 indicate systematic causes requiring investigation before the process goes out of spec.
- **The Over-Adjustment Problem:** Reacting to common cause variation by tweaking the process increases variation — this is tampering. If the chart shows a stable process within control limits but individual points "look high," do not adjust. Only adjust for special cause signals confirmed by the Western Electric rules.
- **Common vs. Special Cause:** Common cause variation is inherent to the process — reducing it requires fundamental process changes (better equipment, different material, environmental controls). Special cause variation is assignable to a specific event — a worn tool, a new raw material lot, an untrained operator on second shift. SPC's primary function is detecting special causes quickly.

### Supplier Quality Management

- **Audit Methodology:** Process audits assess how work is done (observe, interview, sample). System audits assess QMS compliance (document review, record sampling). Product audits verify specific product characteristics. Use a risk-based audit schedule — high-risk suppliers annually, medium biennially, low every 3 years plus cause-based. Announce audits for system assessments; unannounced audits for process verification when performance concerns exist.
- **Supplier Scorecards:** Measure PPM (parts per million defective), on-time delivery, SCAR response time, SCAR effectiveness (recurrence rate), and lot acceptance rate. Weight the metrics by business impact. Share scorecards quarterly. Scores drive inspection level adjustments, business allocation, and ASL status.
- **Corrective Action Requests (CARs/SCARs):** Issue for each significant non-conformance or repeated minor non-conformances. Expect 8D or equivalent root cause analysis. Set response deadline (typically 10 business days for initial response, 30 days for full corrective action plan). Follow up on effectiveness verification.
- **Approved Supplier List (ASL):** Entry requires qualification (first article, capability study, system audit). Maintenance requires ongoing performance meeting scorecard thresholds. Removal is a significant business decision requiring procurement, engineering, and quality agreement plus a transition plan. Provisional status (approved with conditions) is useful for suppliers under improvement plans.
- **Develop vs. Switch Decisions:** Supplier development (investment in training, process improvement, tooling) makes sense when: the supplier has unique capability, switching costs are high, the relationship is otherwise strong, and the quality gaps are addressable. Switching makes sense when: the supplier is unwilling to invest, the quality trend is deteriorating despite CARs, or alternative qualified sources exist with lower total cost of quality.

### Regulatory Frameworks

- **FDA 21 CFR 820 (QSR):** Covers medical device quality systems. Key sections: 820.90 (nonconforming product), 820.100 (CAPA), 820.198 (complaint handling), 820.250 (statistical techniques). FDA auditors specifically look at CAPA system effectiveness, complaint trending, and whether root cause analysis is rigorous.
- **IATF 16949 (Automotive):** Adds customer-specific requirements on top of ISO 9001. Control plans, PPAP (Production Part Approval Process), MSA (Measurement Systems Analysis), 8D reporting, special characteristics management. Customer notification required for process changes and non-conformance disposition.
- **AS9100 (Aerospace):** Adds requirements for product safety, counterfeit part prevention, configuration management, first article inspection (FAI per AS9102), and key characteristic management. Customer approval required for use-as-is dispositions. OASIS database for supplier management.
- **ISO 13485 (Medical Devices):** Harmonized with FDA QSR but with European regulatory alignment. Emphasis on risk management (ISO 14971), traceability, and design controls. Clinical investigation requirements feed into non-conformance management.
- **Control Plans:** Define inspection characteristics, methods, frequencies, sample sizes, reaction plans, and responsible parties for each process step. Required by IATF 16949 and good practice universally. Must be a living document updated when processes change.
