import com.github.javaparser.JavaParser;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import testsmell.*;
import thresholds.DefaultThresholds;

/** Reads engine-confirmed smelly elements and resolves unambiguous AST names. */
public final class LocationBridge {
  static void row(Writer out, String... values) throws IOException {
    for (int i=0;i<values.length;i++) {
      if(i>0)out.write(',');
      out.write('"');out.write(values[i].replace("\"","\"\""));out.write('"');
    }
    out.write('\n');
  }
  static void finding(Writer out,String smell,String scope,String name,Node node) throws IOException {
    Range r=node==null?null:node.getRange().orElse(null);
    row(out,smell,scope,name,r==null?"":String.valueOf(r.begin.line),
      r==null?"":String.valueOf(r.begin.column),r==null?"":String.valueOf(r.end.line),
      r==null?"":String.valueOf(r.end.column+1));
  }
  public static void main(String[] args) throws Exception {
    if(args.length!=4)throw new IllegalArgumentException("Expected application, test, production and output paths");
    TestFile file=new TestSmellDetector(new DefaultThresholds()).detectSmells(new TestFile(args[0],args[1],args[2]));
    CompilationUnit cu=JavaParser.parse(new File(args[1]));
    List<MethodDeclaration> methods=cu.getNodesByType(MethodDeclaration.class);
    List<TypeDeclaration> types=cu.getNodesByType(TypeDeclaration.class);
    try(Writer out=Files.newBufferedWriter(Paths.get(args[3]),StandardCharsets.UTF_8)) {
      row(out,"TSDETECT_LOCATIONS_V1",String.valueOf(file.getNumberOfTestMethods()));
      for(AbstractSmell smell:file.getTestSmells()) {
        if(smell==null)throw new IOException("Detector returned an unavailable smell result");
        if(!smell.hasSmell())continue;
        for(SmellyElement element:smell.getSmellyElements()) {
          if(!element.isSmelly())continue;
          String name=element.getElementName();
          List<Node> matches=new ArrayList<>();String scope="file";
          if(element instanceof TestMethod) {
            for(MethodDeclaration m:methods)if(m.getNameAsString().equals(name)&&Util.isValidTestMethod(m))matches.add(m.getName());
            if(matches.size()==1)scope="method";
          } else if(element instanceof TestClass) {
            for(TypeDeclaration t:types)if(t.getNameAsString().equals(name))matches.add(t.getName());
            if(matches.size()==1)scope="class";
          }
          // The engine stores only names, so duplicate/overloaded names are ambiguous.
          // Never guess which declaration was intended.
          finding(out,smell.getSmellName(),scope,name,matches.size()==1?matches.get(0):null);
        }
      }
    }
  }
}
