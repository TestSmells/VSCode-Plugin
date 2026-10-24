import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class FormatterTest {
    @Test
    public void removesOuterSpaces() {
        Formatter formatter = new Formatter();
        assertEquals("hello", formatter.normalize(" hello "));
    }

    @Test
    public void convertsUppercaseLetters() {
        Formatter formatter = new Formatter();
        assertEquals("hello", formatter.normalize("HELLO"));
    }
}
