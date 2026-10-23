"""Fictional places, institutions and people for the synthetic dataset.

All names are invented. Towns are imaginary, and person surnames are deliberately unusual nature
words so that nobody can mistake them for real colleges, officers or committee members.
"""

REGIONS = [
    ("NR", "Northern"),
    ("SR", "Southern"),
    ("ER", "Eastern"),
    ("WR", "Western"),
    ("CR", "Central"),
    ("NER", "North-Eastern"),
    ("SWR", "South-Western"),
]

# (town, region code, kind suffix, kind)
INSTITUTIONS = [
    ("Ambervale", "NR", "Institute of Technology", "Engineering"),
    ("Brightwater", "NR", "College of Engineering", "Engineering"),
    ("Cedarbrook", "NR", "School of Management", "Management"),
    ("Dawnridge", "NR", "College of Pharmacy", "Pharmacy"),
    ("Elmstead", "NR", "Polytechnic", "Polytechnic"),
    ("Fernhollow", "NR", "Institute of Technology", "Engineering"),
    ("Goldmere", "NR", "School of Architecture", "Architecture"),
    ("Hazelford", "NR", "College of Engineering", "Engineering"),
    ("Ironwood", "SR", "Institute of Technology", "Engineering"),
    ("Juniper Bay", "SR", "College of Engineering", "Engineering"),
    ("Lotus Creek", "SR", "School of Management", "Management"),
    ("Maplecross", "SR", "College of Pharmacy", "Pharmacy"),
    ("Northmere", "SR", "Polytechnic", "Polytechnic"),
    ("Oakhaven", "SR", "Institute of Technology", "Engineering"),
    ("Pinewhistle", "SR", "College of Engineering", "Engineering"),
    ("Quillfield", "ER", "Institute of Technology", "Engineering"),
    ("Rivenmoor", "ER", "College of Engineering", "Engineering"),
    ("Silverbirch Vale", "ER", "School of Management", "Management"),
    ("Thornbury Glen", "ER", "Polytechnic", "Polytechnic"),
    ("Umberton", "ER", "College of Pharmacy", "Pharmacy"),
    ("Valewood", "WR", "Institute of Technology", "Engineering"),
    ("Willowmere", "WR", "College of Engineering", "Engineering"),
    ("Yarrowdale", "WR", "School of Management", "Management"),
    ("Zephyr Point", "WR", "School of Architecture", "Architecture"),
    ("Ashgrove", "WR", "Polytechnic", "Polytechnic"),
    ("Bluestone Reach", "WR", "College of Pharmacy", "Pharmacy"),
    ("Coppergate", "CR", "Institute of Technology", "Engineering"),
    ("Dunmore Heights", "CR", "College of Engineering", "Engineering"),
    ("Eastwind", "CR", "School of Management", "Management"),
    ("Foxglove Hill", "CR", "Polytechnic", "Polytechnic"),
    ("Greyfeather", "CR", "College of Pharmacy", "Pharmacy"),
    ("Highmeadow", "NER", "Institute of Technology", "Engineering"),
    ("Ivyleigh", "NER", "College of Engineering", "Engineering"),
    ("Jasper Falls", "NER", "Polytechnic", "Polytechnic"),
    ("Kestrel Ridge", "NER", "School of Management", "Management"),
    ("Lark Hollow", "SWR", "Institute of Technology", "Engineering"),
    ("Moonbrook", "SWR", "College of Engineering", "Engineering"),
    ("Nettlefield", "SWR", "College of Pharmacy", "Pharmacy"),
    ("Opal Springs", "SWR", "Polytechnic", "Polytechnic"),
    ("Pebblecombe", "SWR", "School of Architecture", "Architecture"),
]

GIVEN = [
    "Aarav", "Kavya", "Ishaan", "Meera", "Rohan", "Ananya", "Vihaan", "Diya", "Kabir", "Saanvi", "Arnav", "Tara",
    "Reyansh", "Myra", "Advait", "Ira", "Dhruv", "Anika", "Vivaan", "Nisha", "Yash", "Pooja", "Aditya", "Riya",
    "Karan", "Sneha", "Nikhil", "Leela", "Omkar", "Zoya", "Pranav", "Gauri", "Siddharth", "Aditi", "Manav", "Rhea",
    "Varun", "Juhi", "Harsh", "Esha",
]
SURNAMES = [
    "Larkspur", "Wrenfield", "Hazelbrook", "Duskwood", "Thistledown", "Emberly", "Lumenhart", "Quillon",
    "Fennick", "Brambleton", "Hollowell", "Marrowind", "Glimmerton", "Kestrelby", "Mistvale", "Ashbright",
    "Ivoryn", "Juniperson", "Moonfield", "Nettleby", "Oakenshade", "Pebbleford", "Rainwhistle", "Sablewood",
    "Tansywell", "Umberleaf", "Velvetmoss", "Willowbank", "Yarrowby", "Zephyrine", "Cloverdell", "Dewmarsh",
    "Elderwick", "Fernwhistle", "Goldthorn", "Heathermoor", "Inkberry", "Jadebrook", "Kindlewood", "Lilyfold",
]

PROGRAMMES = {
    "Engineering": ["B.Tech Computer Science and Engineering (60 seats)", "B.Tech Electronics and Communication (60 seats)",
                    "B.Tech Civil Engineering (60 seats)", "M.Tech Data Science (18 seats)",
                    "B.Tech Artificial Intelligence and Data Science (60 seats)"],
    "Management": ["MBA (120 seats)", "PGDM (60 seats)", "MBA Business Analytics (60 seats)"],
    "Pharmacy": ["B.Pharm (100 seats)", "D.Pharm (60 seats)", "M.Pharm Pharmaceutics (15 seats)"],
    "Architecture": ["B.Arch (40 seats)", "M.Arch Urban Design (20 seats)"],
    "Polytechnic": ["Diploma in Mechanical Engineering (60 seats)", "Diploma in Computer Engineering (60 seats)",
                    "Diploma in Civil Engineering (60 seats)"],
}

DEFICIENCY_REASONS = [
    "Land documents do not show the registered lease in the name of the trust. Upload the registered lease deed.",
    "Faculty list is short of the required cadre ratio for the proposed intake. Upload revised faculty details.",
    "Building completion certificate is missing for the new academic block. Upload the certificate.",
    "Fire safety NOC copy is not legible. Upload a clear, signed copy.",
    "Affidavit is not notarised. Upload a notarised affidavit in the prescribed format.",
    "Library and laboratory details do not match the proposed courses. Upload corrected details.",
    "Bank balance certificate is older than the permitted date. Upload a current certificate.",
    "Approved building plan does not show the built-up area claimed. Upload the sanctioned plan.",
]
REPLIES = [
    "We have uploaded the registered document and the corrected details as requested.",
    "Corrected faculty list with appointment letters is uploaded. Please re-check.",
    "The required certificate is uploaded. The earlier copy was an older version.",
    "Clear signed copy uploaded along with a covering letter from the Principal.",
]
FINDINGS = [
    "Infrastructure, laboratories and library are available as claimed. Faculty present matched the submitted list.",
    "Classrooms and laboratories are adequate. Two laboratories need additional equipment as per the norms.",
    "Built-up area matches the sanctioned plan. Hostel facilities are under construction and not yet usable.",
    "All facilities verified. Computer centre and internet bandwidth meet the requirement.",
]
DECISION_REASONS = {
    "approved": "All stages completed and requirements found satisfactory on the records placed before the authority.",
    "approved_with_undertakings": "Requirements largely met. Approval granted subject to the listed time-bound undertakings.",
    "not_approved": "Essential requirements were not met as per the scrutiny and visit records.",
}
UNDERTAKING_CONDITIONS = [
    "Complete the second floor of the academic block and submit the completion certificate.",
    "Appoint two additional faculty members in the proposed department and upload appointment letters.",
    "Install the additional laboratory equipment noted by the expert committee and upload purchase proof.",
    "Submit the registered lease deed for the additional land parcel.",
    "Obtain the renewed fire safety NOC for the hostel block.",
    "Upgrade the library with the prescribed number of titles and journals and upload the stock register.",
    "Submit the audited accounts of the trust for the last financial year.",
    "Operationalise the girls' hostel and upload the occupancy certificate.",
]
