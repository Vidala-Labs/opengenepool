/**
 * Seed data for the example - pUC19 plasmid (raw GenBank format)
 */
import { parseGenBank } from './genbank-parser.js'

const pUC19_GENBANK = `LOCUS       pUC19                   2686 bp DNA     circular SYN 30-SEP-2025
DEFINITION  Standard E. coli vector with a multiple cloning site (MCS) for DNA
            cloning.
FEATURES             Location/Qualifiers
     protein_bind    133..154
                     /label=CAP binding site
     promoter        169..199
                     /label=lac promoter
     protein_bind    207..223
                     /label=lac operator
     primer_bind     231..247
                     /label=M13 rev
     misc_feature    260..316
                     /label=MCS
     primer_bind     complement(317..333)
                     /label=M13 fwd
     promoter        807..911
                     /label=AmpR promoter
     CDS             912..1769
                     /label=AmpR
     rep_origin      1943..2531
                     /label=ori
ORIGIN
        1 cgagtcagtg agcgaggaag cggaagagcg cccaatacgc aaaccgcctc tccccgcgcg
       61 ttggccgatt cattaatgca gctggcacga caggtttccc gactggaaag cgggcagtga
      121 gcgcaacgca attaatgtga gttagctcac tcattaggca ccccaggctt tacactttat
      181 gcttccggct cgtatgttgt gtggaattgt gagcggataa caatttcaca caggaaacag
      241 ctatgaccat gattacgcca agcttgcatg cctgcaggtc gactctagag gatccccggg
      301 taccgagctc gaattcactg gccgtcgttt tacaacgtcg tgactgggaa aaccctggcg
      361 ttacccaact taatcgcctt gcagcacatc cccctttcgc cagctggcgt aatagcgaag
      421 aggcccgcac cgatcgccct tcccaacagt tgcgcagcct gaatggcgaa tggcgcctga
      481 tgcggtattt tctccttacg catctgtgcg gtatttcaca ccgcatatgg tgcactctca
      541 gtacaatctg ctctgatgcc gcatagttaa gccagccccg acacccgcca acacccgctg
      601 acgcgccctg acgggcttgt ctgctcccgg catccgctta cagacaagct gtgaccgtct
      661 ccgggagctg catgtgtcag aggttttcac cgtcatcacc gaaacgcgcg agacgaaagg
      721 gcctcgtgat acgcctattt ttataggtta atgtcatgat aataatggtt tcttagacgt
      781 caggtggcac ttttcgggga aatgtgcgcg gaacccctat ttgtttattt ttctaaatac
      841 attcaaatat gtatccgctc atgagacaat aaccctgata aatgcttcaa taatattgaa
      901 aaaggaagag tatgagtatt caacatttcc gtgtcgccct tattcccttt tttgcggcat
      961 tttgccttcc tgtttttgct cacccagaaa cgctggtgaa agtaaaagat gctgaagatc
     1021 agttgggtgc acgagtgggt tacatcgaac tggatctcaa cagcggtaag atccttgaga
     1081 gttttcgccc cgaagaacgt tttccaatga tgagcacttt taaagttctg ctatgtggcg
     1141 cggtattatc ccgtattgac gccgggcaag agcaactcgg tcgccgcata cactattctc
     1201 agaatgactt ggttgagtac tcaccagtca cagaaaagca tcttacggat ggcatgacag
     1261 taagagaatt atgcagtgct gccataacca tgagtgataa cactgcggcc aacttacttc
     1321 tgacaacgat cggaggaccg aaggagctaa ccgctttttt gcacaacatg ggggatcatg
     1381 taactcgcct tgatcgttgg gaaccggagc tgaatgaagc cataccaaac gacgagcgtg
     1441 acaccacgat gcctgtagca atggcaacaa cgttgcgcaa actattaact ggcgaactac
     1501 ttactctagc ttcccggcaa caattaatag actggatgga ggcggataaa gttgcaggac
     1561 cacttctgcg ctcggccctt ccggctggct ggtttattgc tgataaatct ggagccggtg
     1621 agcgtgggtc tcgcggtatc attgcagcac tggggccaga tggtaagccc tcccgtatcg
     1681 tagttatcta cacgacgggg agtcaggcaa ctatggatga acgaaataga cagatcgctg
     1741 agataggtgc ctcactgatt aagcattggt aactgtcaga ccaagtttac tcatatatac
     1801 tttagattga tttaaaactt catttttaat ttaaaaggat ctaggtgaag atcctttttg
     1861 ataatctcat gaccaaaatc ccttaacgtg agttttcgtt ccactgagcg tcagaccccg
     1921 tagaaaagat caaaggatct tcttgagatc ctttttttct gcgcgtaatc tgctgcttgc
     1981 aaacaaaaaa accaccgcta ccagcggtgg tttgtttgcc ggatcaagag ctaccaactc
     2041 tttttccgaa ggtaactggc ttcagcagag cgcagatacc aaatactgtt cttctagtgt
     2101 agccgtagtt aggccaccac ttcaagaact ctgtagcacc gcctacatac ctcgctctgc
     2161 taatcctgtt accagtggct gctgccagtg gcgataagtc gtgtcttacc gggttggact
     2221 caagacgata gttaccggat aaggcgcagc ggtcgggctg aacggggggt tcgtgcacac
     2281 agcccagctt ggagcgaacg acctacaccg aactgagata cctacagcgt gagctatgag
     2341 aaagcgccac gcttcccgaa gggagaaagg cggacaggta tccggtaagc ggcagggtcg
     2401 gaacaggaga gcgcacgagg gagcttccag ggggaaacgc ctggtatctt tatagtcctg
     2461 tcgggtttcg ccacctctga cttgagcgtc gatttttgtg atgctcgtca ggggggcgga
     2521 gcctatggaa aaacgccagc aacgcggcct ttttacggtt cctggccttt tgctggcctt
     2581 ttgctcacat gttctttcct gcgttatccc ctgattctgt ggataaccgt attaccgcct
     2641 ttgagtgagc tgataccgct cgccgcagcc gaacgaccga gcgcag
//`

// Parse at module load time
const parsed = parseGenBank(pUC19_GENBANK)

export const pUC19 = {
  id: 'puc19-seed',
  ...parsed
}

// A short test sequence for alignment testing
export const testAlignmentSequence = {
  id: 'test-alignment-seed',
  name: 'Test Alignment Sequence',
  sequence: 'CGAGTCAGTGAGCGAGGAAGCGGAAGAGCGCCCAATACGCAAACCGCCTCTCCCCGCGCGTTGGCCGATTCATTAATGCAGCTGGCACGACAGGTTTCCCGACTGGAAAGCGGGCAGTGAGCGCAACGCAATTAATGTGAGTTAGCTCACTCATTAGGCACCCCAGGCTTTACACTTTATGCTTCCGGCTCGTATGTTGTGTGGAATTGTGAGCGGATAACAATTTCACACAGGAAACAGCTATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTAATCGCCTTGCAGCACATCCCCCTTTCGCCAGCTGGCGTAATAGCGAAGAGGCCCGCACCGATCGCCCTTCCCAACAGTTGCGCAGCCTGAATGGCGAATGGCGCCTGATGCGGTATTTTCTCCTTACGCATCTGTGCGGTATTTCACACCGCATATGGTGCACTCTCAGTACAATCTGCTCTGATGCCGCATAGTTAAGCCAGCCCCGACACCCGCCAACACCCGCTGACGCGCCCTGACGGGCTTGTCTGCTCCCGGCATCCGCTTACAGACAAGCTGTGACCGTCTCCGGGAGCTGCATGTGTCAGAGGTTTTCACCGTCATCACCGAAACGCGCGAGACGAAAGGGCCTCGTGATACGCCTATTTTTATAGGTTAATGTCATGATAATAATGGTTTCTTAGACGTCAGGTGGCACTTTTCGGGGAAATGTGCGCGGAACCCCTATTTGTTTATTTTTCTAAATACATTCAAATATGTATCCGCTCATGAGACAATAACCCTGATAAATGCTTCAATAATATTGAAAAAGGAAGAGTATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAACTGTCAGACCAAGTTTACTCATATATACTTTAGATTGATTTAAAACTTCATTTTTAATTTAAAAGGATCTAGGTGAAGATCCTTTTTGATAATCTCATGACCAAAATCCCTTAACGTGAGTTTTCGTTCCACTGAGCGTCAGACCCCGTAGAAAAGATCAAAGGATCTTCTTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGTTCTTTCCTGCGTTATCCCCTGATTCTGTGGATAACCGTATTACCGCCTTTGAGTGAGCTGATACCGCTCGCCGCAGCCGAACGACCGAGCGCAG',
  annotations: [],
  metadata: {
    circular: true
  }
}
